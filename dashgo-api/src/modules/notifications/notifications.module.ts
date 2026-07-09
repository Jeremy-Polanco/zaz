import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushToken } from '../../entities/push-token.entity';
import { PushService } from './push.service';
import { MePushTokensController } from './me-push-tokens.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PushToken])],
  controllers: [MePushTokensController],
  providers: [PushService],
  exports: [PushService],
})
export class NotificationsModule {}
