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

/** THE upload path — there is exactly one, and it is never branched by environment. */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | undefined;

  constructor(private readonly config: AppConfigService) {
    const endpoint = config.get('S3_ENDPOINT');
    this.bucket = config.get('S3_BUCKET');
    this.publicBaseUrl = config.get('S3_PUBLIC_URL');

    this.client = new S3Client({
      region: config.get('S3_REGION'),
      // Undefined endpoint = the real AWS S3 endpoint for the region.
      endpoint,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY'),
      },
    });

    this.logger.log(`Storage ready: bucket "${this.bucket}" at ${endpoint ?? 'aws s3'}`);
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async upload(key: string, body: Buffer | Uint8Array | string, contentType?: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, url: this.publicUrl(key) };
  }

  /** Hand the browser a short-lived URL so large files never proxy through the API. */
  async createUploadUrl(key: string, contentType: string, expiresInSec = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSec },
    );
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

  /**
   * Stable public URL for an object. In production this is the CloudFront / bucket origin; locally
   * it points straight at MinIO.
   */
  publicUrl(key: string): string {
    const base = this.publicBaseUrl ?? `${this.config.get('S3_ENDPOINT') ?? ''}/${this.bucket}`;
    return `${base.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }
}
