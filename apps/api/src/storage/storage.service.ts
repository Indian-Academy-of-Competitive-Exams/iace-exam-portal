import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../config/app-config.service';

/**
 * THE upload path — there is exactly one, and it is never branched by
 * environment. Local dev talks to MinIO and production talks to AWS S3 through
 * the identical AWS SDK v3 calls below; only S3_ENDPOINT, the credentials and
 * S3_FORCE_PATH_STYLE differ, and those come from env.
 *
 *   local:      S3_ENDPOINT=http://localhost:9000  S3_FORCE_PATH_STYLE=true
 *   production: S3_ENDPOINT unset                  S3_FORCE_PATH_STYLE=false
 */
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

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Used by /health — proves credentials and the bucket are both good. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /**
   * Stable public URL for an object. In production this is the CloudFront /
   * bucket origin; locally it points straight at MinIO.
   */
  publicUrl(key: string): string {
    const base = this.publicBaseUrl ?? `${this.config.get('S3_ENDPOINT') ?? ''}/${this.bucket}`;
    return `${base.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }
}
