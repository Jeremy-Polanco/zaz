import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushToken } from '../../entities/push-token.entity';
import { AppSetting } from '../../entities/app-setting.entity';
import { User } from '../../entities/user.entity';
import { PushService } from './push.service';
import { BroadcastService } from './broadcast.service';
import { AppSettingsService } from './app-settings.service';
import { BirthdayCron } from './birthday.cron';
import { MePushTokensController } from './me-push-tokens.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [TypeOrmModule.forFeature([PushToken, AppSetting, User]), WhatsAppModule],
  controllers: [MePushTokensController, AdminNotificationsController],
  providers: [PushService, BroadcastService, AppSettingsService, BirthdayCron],
  exports: [PushService],
})
export class NotificationsModule {}
