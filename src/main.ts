import { NestFactory, Reflector } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Order matters here:
  //   1. HttpLoggingInterceptor — mints req.id, logs the inbound request
  //   2. ResponseInterceptor    — wraps the controller return value in the
  //                                { success, message, data, meta } envelope,
  //                                reading req.id that step 1 just set
  // After the handler returns, RxJS pipes unwind in REVERSE: ResponseInterceptor
  // maps first, then HttpLoggingInterceptor's tap logs the outbound status.
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new HttpLoggingInterceptor(reflector),
    new ResponseInterceptor(reflector),
  );

  // CORS: lock to the FRONTEND_URL allowlist in prod (so only trusted frontends
  // can call the API from a browser); wide-open in dev so curl / Swagger UI /
  // Postman / arbitrary localhost ports all work without ceremony.
  //
  // FRONTEND_URL is comma-separated; we split into an array so multiple origins
  // (user app + management dashboard, www + apex, preview deploys) all work.
  // `credentials: true` lets the frontend send cookies cross-origin — required
  // for the cookie-based JWT pattern we're using on the Next.js side.
  const isProd = config.get<string>('NODE_ENV') === 'production';
  const allowedOrigins = config
    .get<string>('FRONTEND_URL', 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  app.enableCors({
    origin: isProd ? allowedOrigins : true,
    credentials: true,
  });

  app.enableShutdownHooks(); // so PrismaService.onModuleDestroy fires on SIGTERM

  // ---------------- Swagger / OpenAPI ----------------
  const swaggerConfig = new DocumentBuilder()
    .setTitle('XchangeNow API')
    .setDescription(
      'Fintech backend: auth (with email verification + password reset), ' +
        'users, wallets, transactions (BUY/SELL/SWAP), payouts, rates, security.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Paste the accessToken from POST /api/auth/login',
        in: 'header',
      },
      'JWT-auth', // a name we can later reference via @ApiBearerAuth('JWT-auth')
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // remember the bearer token across page reloads
    },
  });

  await app.listen(port);

  Logger.log(
    `XchangeNow API running on http://localhost:${port}/api`,
    'Bootstrap',
  );
  Logger.log(`Swagger UI at http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
