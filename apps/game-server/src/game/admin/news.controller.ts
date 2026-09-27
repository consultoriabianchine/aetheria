import { Prisma } from '@aetheria/database';
import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';

type NewsStatus = 'draft' | 'published' | 'archived';

interface NewsInput {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  coverImage?: string | null;
  author?: string | null;
  status?: NewsStatus;
}

function toView(news: {
  id: string; title: string; slug: string; excerpt: string; content: string;
  coverImage: string | null; status: string; author: string | null;
  publishedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: news.id,
    title: news.title,
    slug: news.slug,
    excerpt: news.excerpt,
    content: news.content,
    coverImage: news.coverImage,
    status: news.status,
    author: news.author,
    publishedAt: news.publishedAt,
    createdAt: news.createdAt,
    updatedAt: news.updatedAt,
  };
}

function normalizeSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

@Controller('admin/news')
@UseGuards(AdminAuthGuard)
export class NewsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('status') status?: string) {
    const where = status && ['draft', 'published', 'archived'].includes(status) ? { status } : undefined;
    const rows = await this.prisma.news.findMany({ where, orderBy: [{ updatedAt: 'desc' }] });
    return rows.map(toView);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const news = await this.prisma.news.findUnique({ where: { id } });
    if (!news) throw new NotFoundException('Notícia não encontrada.');
    return toView(news);
  }

  @Post()
  async create(@Body() body: NewsInput) {
    const data = this.validate(body);
    try {
      const news = await this.prisma.news.create({ data: data as Prisma.NewsCreateInput });
      await this.audit('NEWS_CREATED', news.id, null, news);
      return { ok: true, news: toView(news) };
    } catch (error) {
      this.handleUnique(error);
      throw error;
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: NewsInput) {
    const existing = await this.prisma.news.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Notícia não encontrada.');
    const data = this.validate(body, true);
    try {
      const news = await this.prisma.news.update({ where: { id }, data: data as Prisma.NewsUpdateInput });
      await this.audit('NEWS_UPDATED', id, existing, news);
      return { ok: true, news: toView(news) };
    } catch (error) {
      this.handleUnique(error);
      throw error;
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.news.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Notícia não encontrada.');
    await this.prisma.news.delete({ where: { id } });
    await this.audit('NEWS_DELETED', id, existing, null);
    return { ok: true };
  }

  @Put(':id/publish')
  async publish(@Param('id') id: string) {
    return this.setStatus(id, 'published');
  }

  @Put(':id/archive')
  async archive(@Param('id') id: string) {
    return this.setStatus(id, 'archived');
  }

  private async setStatus(id: string, status: NewsStatus) {
    const existing = await this.prisma.news.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Notícia não encontrada.');
    const news = await this.prisma.news.update({
      where: { id },
      data: { status, publishedAt: status === 'published' ? (existing.publishedAt ?? new Date()) : existing.publishedAt },
    });
    await this.audit(`NEWS_${status.toUpperCase()}`, id, existing, news);
    return { ok: true, news: toView(news) };
  }

  private validate(body: NewsInput, partial = false): Prisma.NewsUncheckedCreateInput | Prisma.NewsUncheckedUpdateInput {
    const title = body.title?.trim();
    const content = body.content?.trim();
    if (!partial && (!title || !content)) throw new BadRequestException('Título e conteúdo são obrigatórios.');
    if (title !== undefined && !title) throw new BadRequestException('Título não pode ficar vazio.');
    if (content !== undefined && !content) throw new BadRequestException('Conteúdo não pode ficar vazio.');
    const slug = body.slug === undefined ? (title ? normalizeSlug(title) : undefined) : normalizeSlug(body.slug || title || '');
    if (!partial && !slug) throw new BadRequestException('Slug inválido.');
    if (slug !== undefined && !slug) throw new BadRequestException('Slug inválido.');
    return {
      ...(title === undefined ? {} : { title }),
      ...(content === undefined ? {} : { content }),
      ...(slug === undefined ? {} : { slug }),
      ...(body.excerpt === undefined ? {} : { excerpt: body.excerpt.trim() }),
      ...(body.coverImage === undefined ? {} : { coverImage: body.coverImage?.trim() || null }),
      ...(body.author === undefined ? {} : { author: body.author?.trim() || null }),
      ...(body.status === undefined ? {} : { status: body.status }),
    };
  }

  private handleUnique(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new BadRequestException('Slug já utilizado.');
    }
  }

  private audit(action: string, id: string, before: unknown, after: unknown) {
    return this.prisma.adminAuditLog.create({
      data: {
        actor: 'admin', action, entity_type: 'news', entity_id: id,
        before: before === null ? undefined : (before as object),
        after: after === null ? undefined : (after as object),
      },
    });
  }
}

@Controller('public/news')
export class PublicNewsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    const take = Math.min(20, Math.max(1, Number.parseInt(limit ?? '6', 10) || 6));
    const rows = await this.prisma.news.findMany({ where: { status: 'published' }, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }], take });
    return rows.map(toView);
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string) {
    const news = await this.prisma.news.findFirst({ where: { slug, status: 'published' } });
    if (!news) throw new NotFoundException('Notícia não encontrada.');
    return toView(news);
  }
}
