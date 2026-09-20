import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true, bodyLimit: config.MAX_TEXT_CHARACTERS * 2 }),
  );
  app.enableCors({ origin: config.CORS_ORIGIN });

  const swagger = new DocumentBuilder()
    .setTitle('LexiLens Local API')
    .setDescription('Local evidence-first consumer document screening API; not a production identity boundary')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(config.PORT, config.HOST);
}

void bootstrap();
