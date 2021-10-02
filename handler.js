"use strict";
const AWS = require("aws-sdk");
const Busboy = require("busboy");

/** バッケット名 */
const BUCKET = process.env.BUCKET;

/**
 * hostを判断して、ローカルもしくはAWSのS3オブジェクトを返す
 * @param {string} host ホスト：例：localhost:3000
 * @returns {S3} S3オブジェクト
 */
const getS3 = (host) => {
  if (host == "localhost:3000") {
    return new AWS.S3({
      signatureVersion: "v4",
      s3ForcePathStyle: true,
      accessKeyId: "S3RVER", // This specific key is required when working offline
      secretAccessKey: "S3RVER",
      endpoint: new AWS.Endpoint("http://localhost:4569"),
    });
  } else {
    return new AWS.S3({ signatureVersion: "v4" });
  }
};

/**
 * HTML formデータの解析をしてアップロードファイルはS3に保存
 * @param {APIGatewayProxyEvent} event API Gateway リクエスト
 * @returns {Json} 解析したformデータの情報
 */
const parseToS3 = (event) =>
  new Promise((resolve, reject) => {
    const busboy = new Busboy({
      headers: { "content-type": event.headers["content-type"] || event.headers["Content-Type"] },
      // limits: MAX_SIZE,
    });
    const result = { files: [] };

    busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
      const uploadFile = {
        filename: filename,
        mimetype: mimetype,
        encoding: encoding,
        fieldname: fieldname,
        backet: BUCKET,
        key: filename,
        content: undefined,
      };

      getS3(event.headers.Host)
        .upload({ Bucket: BUCKET, Key: filename, Body: file }, (err, data) => {
          process.stdout.write("\n");
          if (err) {
            reject(err);
          } else {
            uploadFile.content = data;
            result.files.push(uploadFile);
            resolve(result);
          }
        })
        .on("httpUploadProgress", (progress) => {
          process.stdout.write("Uploaded :: " + parseInt((progress.loaded * 100) / progress.total) + "%\r");
        });
    });

    busboy.on("field", (fieldname, value) => {
      result[fieldname] = value;
    });

    busboy.on("error", (error) => {
      reject(error);
    });

    busboy.on("finish", () => {
      console.log("parse finished");
      // resolve(result);
    });

    busboy.write(event.body, event.isBase64Encoded ? "base64" : "binary");
    busboy.end();
  });

/**
 * オリジン間リソース共有(CORS)の追加ヘッダー
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
};

/**
 * 正常応答を返す
 * @param  {any} data データオブジェクト
 * @return {APIGatewayProxyResult} 成功レスポンス
 */
const responseOk = (data) => {
  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ status: true, data: data }),
  };
};

/**
 * エラー応答を返す
 * @param  {any} error エラーオブジェクト
 * @return {APIGatewayProxyResult} エラーレスポンス
 */
const responseError = (error, statusCode = 500) => {
  return {
    statusCode: statusCode,
    headers: cors,
    body: JSON.stringify({ status: false, error: error }),
  };
};

/**
 * formデータ(multipart/form-data)でファイルをアップロードするHTMLを返す
 * 　GET /{stage}/storage/getForm
 * @param {APIGatewayProxyEvent} _
 * @returns {APIGatewayProxyResult} HTML
 */
module.exports.getForm = async (_) => {
  return {
    statusCode: 200,
    headers: {
      ...cors,
      "content-type": "text/html; charset=utf-8",
    },
    body: `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <title>Upload</title>
  </head>
  <body>
    <h1>S３にファイルをアップロードします</h1>
    <form action="upload" enctype="multipart/form-data" method="post">
      <p>ファイルを選択してください</p>
      <p>ファイル：<input type="file" name="file"></p>
      <p><input type="submit" value="アップロード"></p>
    </form>
  </body>
</html>`,
  };
};

/**
 * formデータ(multipart/form-data)の処理
 * 　POST /{stage}/storage/upload
 * @param {APIGatewayProxyEvent} event API Gateway リクエスト
 * @returns {APIGatewayProxyResult} アップロードしたファイルのS3情報
 */
module.exports.upload = async (event) => {
  try {
    const parseInfo = await parseToS3(event);
    const file = parseInfo.files[0];

    const signedUrl = await getS3(event.headers.Host).getSignedUrlPromise("getObject", {
      Bucket: file.backet,
      Key: file.key,
      Expires: 60,
    });

    return responseOk({
      bucket: file.backet,
      key: file.filename,
      mimeType: file.mimetype,
      url: signedUrl,
    });
  } catch (error) {
    return responseError(error.stack);
  }
};

/**
 * 署名付きURLでファイルをアップロードするHTMLを返す
 *  GET /{stage}/storage/uploadForm
 * @param {APIGatewayProxyEvent} _ 
 * @returns {APIGatewayProxyResult} HTML
 */
module.exports.uploadForm = async (_) => {
  return {
    statusCode: 200,
    headers: {
      ...cors,
      "content-type": "text/html; charset=utf-8",
    },
    body: `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <style type="text/css">
    <!--
      #container {
        margin: 20px;
        width: 400px;
        height: 8px;
        position: relative;
      }
    -->
    </style>
    <script src="https://unpkg.com/axios/dist/axios.min.js"></script>
    <script src="https://rawgit.com/kimmobrunfeldt/progressbar.js/master/dist/progressbar.min.js"></script>
    <title>ファイルアップロード</title>
  </head>
  <body>
    <h1>S３にファイルをアップロードします</h1>
    <p>ファイルを選択してください</p>
    <p>ファイル：<input type="file" id="fileInput" onChange="upload(this)"></p>
    <div id="container"></div>
    <script type="text/javascript">

      const bar = new ProgressBar.Line(container, {
        strokeWidth: 4,
        easing: 'easeInOut',
        duration: 0,
        color: '#FFEA82',
        trailColor: '#eee',
        trailWidth: 1,
        svgStyle: {width: '100%', height: '100%'},
        text: {
          style: {
            // Text color.
            // Default: same as stroke color (options.color)
            color: '#999',
            position: 'absolute',
            right: '0',
            top: '30px',
            padding: 0,
            margin: 0,
            transform: null
          },
          autoStyleContainer: false
        },
        from: {color: '#FFEA82'},
        to: {color: '#ED6A5A'},
        step: (state, bar) => {
          bar.setText(Math.round(bar.value() * 100) + ' %');
        }
      });
      bar.animate(1.0);  // Number from 0.0 to 1.0      

      const upload = async (element) => {
        bar.animate(0.0);
        const file = element.files[0];
        try{
          let res = await axios.get('uploadUrl/' + file.name);
          res = await axios.put(res.data.data, file, {
            onUploadProgress: (progressEvent) => {
              const value = progressEvent.loaded / progressEvent.total;
              bar.animate(value);
            }
          });
          bar.animate(1.0);
          alert('File upload succeeded.');
        }catch(e){
          alert(e);
        }
      }

    </script>
  </body>
</html>`,
  };
};

/**
 * 署名付きURLを取得する
 * @param {APIGatewayProxyEvent} event API Gateway リクエスト
 * @param {string} operation getObject | putObject
 * @returns {APIGatewayProxyResult} 署名付きURL
 */
const getSignedUrl = async (event, operation) => {
  try {
    const signedUrl = await getS3(event.headers.Host).getSignedUrlPromise(operation, {
      Bucket: BUCKET,
      Key: event.pathParameters.fileName,
      Expires: 60,
      // ACL: "public-read",
    });
    return responseOk(signedUrl);
  } catch (error) {
    return responseError(error.stack);
  }
};

/**
 * PUT用署名付きURLを取得する
 * 　GET /{stage}/storage/uploadUrl
 * @param {APIGatewayProxyEvent} event API Gateway リクエスト
 * @returns {APIGatewayProxyResult} 署名付きURL
 */
module.exports.uploadUrl = async (event) => {
  return await getSignedUrl(event, "putObject");
};

/**
 * GET用署名付きURLを取得する
 *  GET /{stage}/storage/downloadUrl
 * @param {APIGatewayProxyEvent} event API Gateway リクエスト
 * @returns {APIGatewayProxyResult} 署名付きURL
 */
module.exports.downloadUrl = async (event) => {
  return await getSignedUrl(event, "getObject");
};

/**
 * S3バケット内のファイルリストを返す
 *  GET /{stage}/storage/list
 * @param {APIGatewayProxyEvent} event API Gateway リクエスト
 * @returns {APIGatewayProxyResult} ファイルリスト
 */
module.exports.list = async (event) => {
  try {
    const params = {
      Bucket: BUCKET,
      ContinuationToken: null,
    };
    let files = {};
    // const files = [];
    while (true) {
      const res = await getS3(event.headers.Host).listObjectsV2(params).promise();
      files = { ...files, ...res.Contents };
      // res.Contents.forEach((item) => files.push(item.Key));

      // 1000件を超える場合は切り詰められる
      if (!res.IsTruncated) break;
      // 次の開始位置トークン
      params.ContinuationToken = res.NextContinuationToken;
    }
    return responseOk(files);
  } catch (error) {
    return responseError(error.stack);
  }
};

/**
 * S3からファイルを削除する
 * 　DELTE /{stage}/storage/remove/{fileName}
 * @param {APIGatewayProxyEvent} event API Gateway リクエスト
 * @returns APIGatewayProxyResult 成功またはエラーレスポンス
 */
module.exports.remove = async (event) => {
  try {
    await getS3(event.headers.Host)
      .deleteObject({
        Bucket: BUCKET,
        Key: event.pathParameters.fileName,
      })
      .promise();
    return responseOk("Delete succeeded.");
  } catch (error) {
    return responseError(error.stack);
  }
};
