import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../config/app-config.service';

/** Undefined hands the SDK its own chain, which on Fargate is the task role. */
export function signedWith(
  accessKeyId: string | undefined,
  secretAccessKey: string | undefined,
): { accessKeyId: string; secretAccessKey: string } | undefined {
  if (accessKeyId === undefined || secretAccessKey === undefined) return undefined;
  return { accessKeyId, secretAccessKey };
}

/** THE upload path — there is exactly one, and it is never branched by environment. */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly mediaBase: string;

  constructor(config: AppConfigService) {
    const endpoint = config.get('S3_ENDPOINT');
    this.bucket = config.get('S3_BUCKET');
    this.mediaBase = config.get('MEDIA_BASE_URL');

    this.client = new S3Client({
      region: config.get('S3_REGION'),
      // Undefined endpoint = the real AWS S3 endpoint for the region.
      endpoint,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
      credentials: signedWith(config.get('S3_ACCESS_KEY_ID'), config.get('S3_SECRET_ACCESS_KEY')),
    });

    this.logger.log(`Storage ready: bucket "${this.bucket}" at ${endpoint ?? 'aws s3'}`);
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async upload(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    cacheControl?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  /** Content everyone sees: one unsigned URL per key, or the CDN caches a copy per student. */
  publicUrl(key: string): string {
    return `${this.mediaBase}/${key}`;
  }

  async createDownloadUrl(key: string, expiresInSec = 900): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }

  /**
   * Reads an object back into memory. For a file the API itself uploaded and
   * must re-read — an import committing the sheet it previewed — never for
   * handing bytes to a browser, which gets a signed URL instead.
   */
  async read(key: string): Promise<Buffer> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = object.Body;
    if (!body) throw new Error(`Object ${key} has no body`);
    return Buffer.from(await body.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Bytes, or null on any HEAD failure — missing, forbidden, network — logged either way. */
  async objectSize(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch (error) {
      this.logger.warn(`objectSize(${key}) failed, treating as missing: ${String(error)}`);
      return null;
    }
  }

  /** Used by /health — proves credentials and the bucket are both good. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
