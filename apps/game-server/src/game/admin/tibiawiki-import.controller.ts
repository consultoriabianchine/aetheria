import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { ImportPreview, TibiaWikiImportService } from './tibiawiki-import.service';

@Controller('admin/tibiawiki')
@UseGuards(AdminAuthGuard)
export class TibiaWikiImportController {
  constructor(private readonly importer: TibiaWikiImportService) {}

  @Post('creature/preview')
  preview(@Body() body: { url?: string }) {
    return this.importer.preview(body.url ?? '');
  }

  @Post('creature/import')
  import(@Body() body: { previewId?: string }) {
    return this.importer.import(body.previewId ?? '');
  }

  @Put('creature/preview/:previewId')
  updatePreview(@Param('previewId') previewId: string, @Body() body: ImportPreview) {
    return this.importer.updatePreview(previewId, body);
  }
}
