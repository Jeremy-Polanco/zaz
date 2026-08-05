import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /**
   * Las rutas públicas ahora SÍ corren la estrategia JWT. Antes cortaban con
   * `return true` antes de resolver al usuario, así que `req.user` quedaba
   * undefined aunque el request trajera un token válido — y el catálogo no
   * podía saber quién estaba mirando para acotarlo al vendedor del cliente.
   *
   * Sigue sin exigir sesión: `handleRequest` decide si la falta de token es
   * fatal (ruta protegida) o simplemente significa "invitado" (ruta pública).
   */
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    if (this.isPublic(context)) {
      // Invitado, token vencido o token roto: todos son "sin usuario", nunca
      // un 401. Una ruta pública no puede volverse inaccesible por mandar un
      // token viejo.
      //
      // `|| null` y no `?? null`: passport manda `false` (no undefined) cuando
      // no hay usuario, y `??` lo dejaría pasar tal cual.
      return (user || null) as TUser;
    }
    return super.handleRequest(
      err,
      user,
      info,
      context,
      status,
    ) as TUser;
  }
}
