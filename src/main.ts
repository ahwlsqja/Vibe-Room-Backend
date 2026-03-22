import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');

  const frontendUrl = configService.get<string>('frontend.url');
  const nodeEnv = configService.get<string>('nodeEnv');

  app.enableCors({
    origin: nodeEnv === 'production' ? frontendUrl : true,
    credentials: true,
  });

  logger.log(
    `CORS origin: ${nodeEnv === 'production' ? frontendUrl : 'all (development)'}`,
  );

  app.enableShutdownHooks();

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = configService.get<number>('port') || 3000;

  await app.listen(port);
  logger.log(`Listening on port ${port}`);
}

bootstrap();
