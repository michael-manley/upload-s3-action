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
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
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

async function uploadObject(params) {
  await s3.send(new PutObjectCommand(params));
  core.info(`uploaded - ${params.Key}`);
  return params.Key;
}

async function run() {
  const sourceDir = slash(path.join(process.cwd(), SOURCE_DIR));

  return Promise.all(
    paths.map((p) => {
      const fileStream = fs.createReadStream(p.path);

      const key = slash(
        path.join(destinationDir, path.relative(sourceDir, p.path)),
      );

      return uploadObject({
        Bucket: BUCKET,
        Body: fileStream,
        Key: key,
        ContentType: lookup(p.path) || 'application/octet-stream',
      });
    }),
  );
}

run()
  .then((keys) => {
    core.info(`object key prefix - ${destinationDir}`);
    core.info(`uploaded objects - ${keys.join(', ')}`);
    core.setOutput('object_key', destinationDir);
    core.setOutput('object_keys', keys);
  })
  .catch((err) => {
    core.error(err);
    core.setFailed(err?.message || String(err));
  });

