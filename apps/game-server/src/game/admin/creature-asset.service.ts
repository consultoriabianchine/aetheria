import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface StoredSpriteAsset {
  creatureId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  imageWidth: number;
  imageHeight: number;
  checksum: string;
  data: Buffer;
}

function detectPngDimensions(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Persistência do blob (BYTEA) da spritesheet de uma criatura. */
@Injectable()
export class CreatureAssetService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(creatureId: number): Promise<StoredSpriteAsset | null> {
    const row = await this.prisma.creatureSpriteAsset.findUnique({ where: { creature_id: creatureId } });
    return row ? this.map(row) : null;
  }

  async upsert(
    creatureId: number,
    input: { fileName: string; mimeType: string; width: number; height: number; data: Uint8Array<ArrayBuffer>; uploadedBy?: string },
  ): Promise<StoredSpriteAsset> {
    const checksum = createHash('sha256').update(input.data).digest('hex');
    const detected = detectPngDimensions(input.data);
    const imageWidth = detected?.width ?? input.width;
    const imageHeight = detected?.height ?? input.height;
    const row = await this.prisma.creatureSpriteAsset.upsert({
      where: { creature_id: creatureId },
      create: {
        creature_id: creatureId,
        file_name: input.fileName,
        mime_type: input.mimeType,
        file_size: input.data.length,
        image_width: imageWidth,
        image_height: imageHeight,
        data: input.data,
        checksum,
        uploaded_by: input.uploadedBy,
      },
      update: {
        file_name: input.fileName,
        mime_type: input.mimeType,
        file_size: input.data.length,
        image_width: imageWidth,
        image_height: imageHeight,
        data: input.data,
        checksum,
        uploaded_by: input.uploadedBy,
      },
    });
    return this.map(row);
  }

  private map(row: {
    creature_id: number;
    file_name: string;
    mime_type: string;
    file_size: number;
    image_width: number;
    image_height: number;
    checksum: string;
    data: Uint8Array;
  }): StoredSpriteAsset {
    return {
      creatureId: row.creature_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      checksum: row.checksum,
      data: Buffer.from(row.data),
    };
  }
}
