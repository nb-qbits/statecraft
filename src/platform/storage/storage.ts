import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3ConnectOptions } from "./check.js";
import { createS3Client } from "./check.js";

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export function createObjectStorage(
  opts: S3ConnectOptions & { bucket: string },
): ObjectStorage {
  const client = createS3Client(opts);
  const bucket = opts.bucket;

  return {
    async put(key: string, body: Buffer, contentType: string): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async get(key: string): Promise<Buffer> {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      const stream = response.Body;
      if (!stream) {
        throw new Error(`Empty response body for key: ${key}`);
      }
      return Buffer.from(await stream.transformToByteArray());
    },

    async exists(key: string): Promise<boolean> {
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
