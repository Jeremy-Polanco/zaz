import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { OtpCode, User } from '../../entities';
import { UserRole } from '../../entities/enums';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { TwilioService } from '../twilio/twilio.service';
import { PromotersService } from '../promoters/promoters.service';

const BCRYPT_ROUNDS = 10;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OtpCode) private readonly otps: Repository<OtpCode>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly twilio: TwilioService,
    private readonly promoters: PromotersService,
  ) {}

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      const user = await this.users.findOne({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
  }

  async sendOtp(dto: SendOtpDto) {
    const phone = dto.phone.trim();

    const recent = await this.otps.findOne({
      where: { phone, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (recent) {
      const elapsed = (Date.now() - recent.createdAt.getTime()) / 1000;
      if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
        throw new BadRequestException(
          `Esperá ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed)}s antes de pedir otro código`,
        );
      }
    }

    const code = this.generateOtpCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.otps.save(
      this.otps.create({ phone, codeHash, expiresAt, attempts: 0 }),
    );

    await this.twilio.sendSms(
      phone,
      `Tu código Zaz es ${code}. Vence en ${OTP_TTL_MINUTES} min.`,
    );

    return { sent: true, expiresAt: expiresAt.toISOString() };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const phone = dto.phone.trim();

    const otp = await this.otps.findOne({
      where: { phone, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!otp) {
      throw new UnauthorizedException('No hay código pendiente para este teléfono');
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('El código expiró — pedí uno nuevo');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'Demasiados intentos fallidos — pedí un código nuevo',
      );
    }

    const ok = await bcrypt.compare(dto.code, otp.codeHash);
    if (!ok) {
      await this.otps.update(otp.id, { attempts: otp.attempts + 1 });
      throw new UnauthorizedException('Código inválido');
    }

    let user = await this.users.findOne({ where: { phone } });
    let isNewUser = false;

    if (!user) {
      if (!dto.fullName) {
        // Don't consume the OTP yet — the client will resubmit with the name
        // using the same still-valid code. Consuming here would force the
        // user to request a brand new SMS for what is really one login flow.
        throw new BadRequestException(
          'Es tu primer ingreso — mandá también tu nombre',
        );
      }

      let referredById: string | null = null;
      if (dto.referralCode) {
        const promoter = await this.promoters.findPromoterByReferralCode(
          dto.referralCode,
        );
        if (!promoter) {
          throw new BadRequestException('Código de referido inválido');
        }
        referredById = promoter.id;
      }

      user = await this.users.save(
        this.users.create({
          phone,
          fullName: dto.fullName,
          email: null,
          role: UserRole.CLIENT,
          referredById,
        }),
      );
      isNewUser = true;
    }

    // OTP is consumed only after we're committed to issuing tokens, so any
    // earlier validation failure leaves the code reusable within its TTL.
    await this.otps.update(otp.id, { consumedAt: new Date() });
    await this.otps.delete({ phone, expiresAt: LessThan(new Date()) });

    const tokens = await this.issueTokens(user);
    return { ...tokens, isNewUser };
  }

  private generateOtpCode(): string {
    const n = randomInt(0, 1_000_000);
    return n.toString().padStart(6, '0');
  }

  private async issueTokens(user: User) {
    const payload = { sub: user.id, phone: user.phone, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '1h'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get<string>('JWT_REFRESH_TTL', '7d'),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        addressDefault: user.addressDefault,
        referralCode: user.referralCode,
      },
    };
  }
}
