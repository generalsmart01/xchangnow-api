import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService, SessionContext } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt.guard';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, this.context(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK) // POST defaults to 201; explicit 200 reads better for login
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.context(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.context(req));
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser('sessionId') sessionId: string): Promise<void> {
    await this.auth.logout(sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  private context(req: Request): SessionContext {
    return {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }
}
