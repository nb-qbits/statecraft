import {
  S3Client,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";

export interface S3ConnectOptions {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function createS3Client(opts: S3ConnectOptions): S3Client {
  return new S3Client({
    endpoint: opts.endpoint,
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
    forcePathStyle: opts.forcePathStyle,
  });
}

export async function checkS3Connection(client: S3Client): Promise<boolean> {
  try {
    await client.send(new ListBucketsCommand({}));
    return true;
  } catch {
    return false;
  }
}
