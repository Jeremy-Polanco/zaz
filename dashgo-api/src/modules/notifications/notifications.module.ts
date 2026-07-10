import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushToken } from '../../entities/push-token.entity';
import { PushService } from './push.service';
import { BroadcastService } from './broadcast.service';
import { MePushTokensController } from './me-push-tokens.controller';
import { AdminNotificationsController } from './admin-notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PushToken])],
  controllers: [MePushTokensController, AdminNotificationsController],
  providers: [PushService, BroadcastService],
  exports: [PushService],
})
export class NotificationsModule {}
