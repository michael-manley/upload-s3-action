const core = require('@actions/core');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const slash = require('slash').default;
const klawSync = require('klaw-sync');
const { lookup } = require('mime-types');

const AWS_KEY_ID = core.getInput('aws_key_id', { required: true });
const SECRET_ACCESS_KEY = core.getInput('aws_secret_access_key', {
  required: true,
});
const BUCKET = core.getInput('aws_bucket', { required: true });
const REGION = core.getInput('region', { required: false });
const SOURCE_DIR = core.getInput('source_dir', { required: true });
const DESTINATION_DIR = core.getInput('destination_dir', { required: false });
const ENDPOINT = core.getInput('endpoint', { required: false });
const USEPATHSTYLE = core.getInput('use_path_style_requests', {
  required: false,
});

const s3options = {
  credentials: {
    accessKeyId: AWS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
  region: REGION,
};

if (ENDPOINT) {
  s3options.endpoint = ENDPOINT;
}
if ((USEPATHSTYLE || '').toLowerCase() === 'true') {
  s3options.forcePathStyle = true;
}

const s3 = new S3Client(s3options);

const destinationDir =
  DESTINATION_DIR === '/' ? shortid() : DESTINATION_DIR || '';
const paths = klawSync(SOURCE_DIR, { nodir: true });

function buildPublicUrl({ endpoint, bucket, key, forcePathStyle }) {
  // Best-effort “Location” equivalent. For AWS S3 this is usually correct.
  // For custom endpoints, this matches the common patterns.
  if (!endpoint) return `https://${bucket}.s3.amazonaws.com/${encodeURI(key)}`;

  const url = new URL(endpoint);
  if (forcePathStyle) {
    // https://endpoint/bucket/key
    return `${url.origin}/${bucket}/${encodeURI(key)}`;
  }
  // https://bucket.endpoint/key
  return `${url.protocol}//${bucket}.${url.host}/${encodeURI(key)}`;
}

async function uploadObject(params) {
  await s3.send(new PutObjectCommand(params));
  core.info(`uploaded - ${params.Key}`);

  const location = buildPublicUrl({
    endpoint: ENDPOINT,
    bucket: params.Bucket,
    key: params.Key,
    forcePathStyle: s3options.forcePathStyle === true,
  });

  core.info(`located - ${location}`);
  return location;
}

async function run() {
  const sourceDir = slash(path.join(process.cwd(), SOURCE_DIR));

  return await Promise.all(
    paths.map((p) => {
      const fileStream = fs.createReadStream(p.path);

      const bucketPath = slash(
        path.join(destinationDir, slash(path.relative(sourceDir, p.path))),
      );

      const params = {
        Bucket: BUCKET,
        ACL: 'public-read',
        Body: fileStream,
        Key: bucketPath,
        ContentType: lookup(p.path) || 'text/plain',
      };

      return uploadObject(params);
    }),
  );
}

run()
  .then((locations) => {
    core.info(`object key - ${destinationDir}`);
    core.info(`object locations - ${locations}`);
    core.setOutput('object_key', destinationDir);
    core.setOutput('object_locations', locations);
  })
  .catch((err) => {
    core.error(err);
    core.setFailed(err?.message || String(err));
  });
