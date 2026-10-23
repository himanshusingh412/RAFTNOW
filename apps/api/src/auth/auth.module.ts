import { Global, Module } from '@nestjs/common';
import { FirebaseAuthService } from './firebase-auth.service';
import { CustomerAuthGuard, VendorAuthGuard, FirebaseUserGuard } from './auth.guard';

@Global()
@Module({
  providers: [FirebaseAuthService, CustomerAuthGuard, VendorAuthGuard, FirebaseUserGuard],
  exports: [FirebaseAuthService, CustomerAuthGuard, VendorAuthGuard, FirebaseUserGuard],
})
export class AuthModule {}
