import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard, AdminPrincipal } from './admin-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UnauthorizedException } from '../../common/exceptions/api.exception';
import { requestMeta } from '../../common/http/request-meta';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 128) password!: string;
}
class MfaDto {
  @IsString() mfa_token!: string;
  @Matches(/^\d{6}$/) code!: string;
}
class CodeDto {
  @Matches(/^\d{6}$/) code!: string;
}
class ChangePasswordDto {
  @IsString() @Length(1, 128) current_password!: string;
  @IsString() @Length(12, 128) new_password!: string;
  @Matches(/^\d{6}$/) code!: string;
}

function bearer(header: string | undefined) {
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
  return header.slice(7).trim();
}

@ApiTags('Admin auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Step 1: email + password. Returns mfa_token, or enrollment_token if 2FA is not yet set up' })
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.email, dto.password, requestMeta(req));
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Step 2: TOTP code → access token' })
  verify(@Body() dto: MfaDto, @Req() req: any) {
    return this.auth.verifyMfa(dto.mfa_token, dto.code, requestMeta(req));
  }

  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enrolment: generate TOTP secret (Authorization: Bearer <enrollment_token>)' })
  setup(@Headers('authorization') authz: string | undefined) {
    return this.auth.setupTotp(bearer(authz));
  }

  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enrolment: confirm first TOTP code → access token' })
  enable(@Headers('authorization') authz: string | undefined, @Body() dto: CodeDto, @Req() req: any) {
    return this.auth.enableTotp(bearer(authz), dto.code, requestMeta(req));
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  async me(@Req() req: { admin: AdminPrincipal }) {
    return this.auth.publicView(await this.prisma.admin.findUniqueOrThrow({ where: { id: req.admin.id } }));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  logout(@Req() req: any) {
    return this.auth.logout(req.admin.id, requestMeta(req));
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword(req.admin.id, dto.current_password, dto.new_password, dto.code, requestMeta(req));
  }
}
