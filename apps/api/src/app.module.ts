import { Module } from '@nestjs/common';
import { DocumentsController, HealthController } from './documents.controller';
import { DocumentService } from './documents.service';

@Module({
  controllers: [HealthController, DocumentsController],
  providers: [DocumentService],
})
export class AppModule {}
