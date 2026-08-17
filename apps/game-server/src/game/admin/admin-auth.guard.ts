import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';

/**
 * Guarda de autenticação da Central de Comando. Exige o header
 * `Authorization: Bearer <ADMIN_TOKEN>`. Se ADMIN_TOKEN não estiver definido
 * (dev local), libera o acesso para não travar o desenvolvimento.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);

  canActivate(ctx: ExecutionContext): boolean {
    const token = process.env.ADMIN_TOKEN;
    if (!token) {
      this.logger.warn('ADMIN_TOKEN não definido — endpoints admin abertos (dev).');
      return true;
    }
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const header = request.headers['authorization'];
    return header === `Bearer ${token}`;
  }
}
