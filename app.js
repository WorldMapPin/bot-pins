const settings = require("./settings.js")

const { Client, DatabaseAPI, PrivateKey } = require('@hiveio/dhive')
const hiveClient = new Client(['https://api.hive.blog']);

const nodemailer = require("nodemailer")
const email = settings.email;
const smtp = nodemailer.createTransport({
  host: settings.email.smtp,
  port: settings.email.port,
  secure: false,
  ignoreTLS: true
})

const mssql = require("mssql")

const dbworldmappin = require("./dbworldmappin");

const bDebug = (process.env.DEBUG==="true")

const msSecond = 1 * 1000
const msMinute = 60 * msSecond
const msHour = 60 * msMinute

const second = 1
const minute = 60 * second
const hour = 60 * minute

const postingKey = PrivateKey.fromString(settings.posting);

async function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function notify(subject,body="") {
  try {
    const info = await smtp.sendMail({
      from: email.from,
      to: email.to,
      subject: subject,
      text: body,
      html: body
    })
  }
  catch(e) {
    logerror(e)
  }
}

function datetoISO(date) {
  return date.toISOString().replace(/T|Z/g," ")
}

function skipNotify(message) {
  const exclusions = [
    "internal error"
  ]
  return exclusions.some(o => message.toLowerCase().includes(o))
}

function log(message) {
  console.log(`${datetoISO(new Date())} - ${message}`);
}

function logerror(message, info="") {
  console.error(`${datetoISO(new Date())} - ${message}`);

  if(!bDebug && !skipNotify(message)) {
    notify(`[hive-worldmappin] ${message}`, info)
  }
}

function logdebug(message) {
  if(bDebug) console.log(`${datetoISO(new Date())} - ${message}`);
}

async function makeComment(pa, pp) {
  const now = new Date();
  const body =
    '<b>Congratulations, your post has been added to <a href="https://worldmappin.com">WorldMapPin</a>! 🎉</b><br/><br>'+
    `Did you know you have <b><a href="https://worldmappin.com/@${pa}" target="_blank">your own profile map</a></b>?<br>` +
    `And every <b><a href="https://worldmappin.com/p/${pp}" target="_blank">post has their own map</a></b> too!<br/><br/>` +
    '<b>Want to have your post on the map too?</b><br/><ul><li>Go to <b><a href="https://worldmappin.com">WorldMapPin</a></b></li>'+
    '<li>Click the <b>get code</b> button</li><li>Click on the map where your post should be (zoom in if needed)</li>'+
    '<li>Copy and paste the generated code in your post (Hive only)</li><li>Congrats, your post is now on the map!</li></ul>'+
    '<a href="https://peakd.com/@worldmappin" target="_blank"><img src="https://worldmappin.com/notify.png?1"/></a>';
  
  const opComment = {
    author: settings.account,
    permlink: "wmp" + now.getTime().toString(),
    title: "",
    body: body,
    parent_author: pa,
    parent_permlink: pp,
    json_metadata: "",
  }
  const opVote = {
    voter: settings.account,
    author: pa,
    permlink: pp,
    weight: settings.upvote_weight * 100
  }  

  try {
    const ops = []
    ops.push(opComment)
    const { id } = await hiveClient.broadcast.comment(opComment, postingKey);
    console.log(`Transaction ID: ${id}`);
    await dbworldmappin.query(
      "UPDATE markerinfo SET isCommented = 1 WHERE username = ? AND postPermLink = ?",
      [pa.toString(), pp.toString()]
    )

    if(settings.upvote_comments) {
      await hiveClient.broadcast.vote(opVote, postingKey)
    }

  } catch (err) {
    console.error(err);
  }
}

async function service() {
  try {
    const pool = await mssql.connect(settings.mssql);
    const res = await pool
      .request()
      .query(`
        SELECT
          id, curator_payout_value, total_payout_value, total_pending_payout_value, pending_payout_value, author_rewards, json_metadata, title, net_votes, permlink, parent_permlink, author, created, url, body
        FROM
          Comments
        WHERE 
          depth = 0 
          AND title != ''
          AND (CONTAINS(body, '"!worldmappin"') OR CONTAINS(body,'"!pinmapple"'))
          AND CONTAINS(body, 'd3scr')
          AND created > GETUTCDATE()-7
        ORDER BY
          created
        `);
    const posts = res.recordsets[0];
    log(`Processing ${posts.length} posts`)

    // const reg = /!worldmappin -*[0-9]+\.*[0-9]* lat -*[0-9]+\.*[0-9]* long.*?d3scr/g;
    const reg = /(!worldmappin|!pinmapple) -*[0-9]+\.*[0-9]* lat -*[0-9]+\.*[0-9]* long.*?d3scr/g;
    for (const post of posts) {
      let postdate = post.created.toISOString().slice(0, 19).replace("T", " ");

      logdebug(`${postdate} - https://peakd.com/@${post.author}/${post.permlink}`)

      if (post.body.match(reg)) {
        const code = post.body.match(reg)[0];
        const project = code.split(" ",1)[0]
        const lat = code.split(project)[1].split("lat")[0];
        const long = code.split("lat")[1].split("long")[0];
        const descr = code.split("long")[1].split("d3scr")[0].trim();

        const permlink = post.permlink;
        const author = post.author;
        const postlink = "https://peakd.com" + post.url;
        const posttitle = post.title;
        const json_metadata = JSON.parse(post.json_metadata);
        let postimg;

        if (
          json_metadata != undefined &&
          json_metadata != null &&
          json_metadata != "" &&
          json_metadata != []
        ) {
          if (
            json_metadata.image != undefined &&
            json_metadata.image != null &&
            json_metadata.image != "" &&
            json_metadata.image != []
          ) {
            if (
              json_metadata.image[0] != undefined &&
              json_metadata.image[0] != null &&
              json_metadata.image[0] != ""
            ) {
              postimg = json_metadata.image[0];
            } else {
              let imgreg = /src=['"]+.*?['"]+/g;
              if (post.body.match(imgreg)) {
                postimg = post.body.match(imgreg)[0];
              } else {
                postimg = "No image";
              }
            }
          } else {
            let imgreg = /src=['"]+.*?['"]+/g;
            if (post.body.match(imgreg)) {
              postimg = post.body.match(imgreg)[0];
            } else {
              postimg = "No image";
            }
          }
        } else {
          let imgreg = /src=['"]+.*?['"]+/g;
          if (post.body.match(imgreg)) {
            postimg = post.body.match(imgreg)[0];
          } else {
            postimg = "No image";
          }
        }

        let postupvote = post.net_votes;
        let postvalue = post.pending_payout_value;
        if (postvalue == 0) {
          postvalue = post.total_payout_value + post.curator_payout_value;
        }
        postvalue = postvalue.toFixed(3);
        let tags = (await pool
          .request()
          .query(`SELECT tag FROM Tags WHERE comment_id = ${post.id}`)
          ).recordsets[0].map(o => o.tag).toString().replaceAll(",",", ")

        let postbody = post.body;
        if (
          postvalue > 0.02 &&
          lat != 0 &&
          long != 0 &&
          lat != undefined &&
          long != undefined
        ) {
          // create or update
          const queryString = `
            INSERT INTO markerinfo (postLink, username, postTitle, longitude, lattitude, postDescription, postPermLink, postDate, tags, postUpvote, postValue, postImageLink, postBody) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE postTitle = ?, longitude = ?, lattitude = ?, postDescription = ?, tags= ?, postUpvote= ?, postValue= ?, postImageLink= ?, postBody= ?
            `
          await dbworldmappin.query(
            queryString,
            [
              postlink.toString(),
              author.toString(),
              posttitle.toString(),
              long.toString(),
              lat.toString(),
              descr.toString(),
              permlink.toString(),
              postdate.toString(),
              tags.toString(),
              postupvote.toString(),
              postvalue.toString(),
              postimg.toString(),
              postbody.toString(),
              posttitle.toString(),
              long.toString(),
              lat.toString(),
              descr.toString(),
              tags.toString(),
              postupvote.toString(),
              postvalue.toString(),
              postimg.toString(),
              postbody.toString(),
            ])

          const isCommented = (await dbworldmappin.query(
            "SELECT isCommented FROM markerinfo WHERE username = ? AND postPermLink = ? LIMIT 1",
            [author.toString(), permlink.toString()]))[0].isCommented
          if (isCommented == 0) {
            log(`${postdate} - https://peakd.com/@${post.author}/${post.permlink}`)
            await makeComment(author, permlink);
            await wait(3 * msSecond);
          }
        } else {
          // automatically delete spam (downvoted to 0)
          await dbworldmappin.query(
            "DELETE FROM markerinfo WHERE postLink = ?",
            [postlink.toString()]
          );
        }
      }
    }
  } catch (e) {
    logerror(e.message);
  }
}


(async () => {
  if(bDebug) {
    log("Debug Started ")
    await service()
    log("Done")
  } else {
    log("Service Started ")
    log(`Interval: ${settings.interval.toString()} minutes(s)`)

    service()
    setInterval(service, settings.interval * msMinute)
  }
})();
