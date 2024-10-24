const axios = require('axios');
const fs = require('fs');

const settings = require("./settings.js")
const { Asset } = require("./asset.js")
const { Client, PrivateKey } = require('@hiveio/dhive')
const hiveClient = new Client(settings.hive_api);

// Initialize nodemailer
const nodemailer = require("nodemailer");
const email = settings.email;
const smtp = nodemailer.createTransport({
  host: email.transport.host,
  port: email.transport.port,
  secure: false,
  ignoreTLS: true
})

// Initialize global variables
const bDebug = process.env.DEBUG==="true" || settings.debug
const msSecond = 1 * 1000
const msMinute = 60 * msSecond
const msHour = 60 * msMinute

const second = 1
const minute = 60 * second
const hour = 60 * minute

const dbworldmappin = require("./dbworldmappin");
const REGEX_PIN = /(!worldmappin|!pinmapple) -*[0-9]+\.*[0-9]* lat -*[0-9]+\.*[0-9]* long.*?d3scr/g;
const postingKey = PrivateKey.fromString(settings.posting);

let bBusy = false
let bBusyNotifications = false
let bFirstBlock = true
let block_num = 0

async function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function notify(subject, body="") {
  try {
    const info = await smtp.sendMail({
      from: email.from,
      to: email.to,
      subject: subject,
      text: body,
      html: body
    })
  } catch(e) {
    logerror(e.message)
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
  console.log(`${datetoISO(new Date())}- ${message}`)
}

function logerror(message, body="") {
  console.error(`${datetoISO(new Date())}- ${message}${body!="" ? " -> ":""}${body}`)
  if(settings.notify?.error  && !skipNotify(message)) {
    notify(`[hive-worldmappin] ${message}`, body)
  }
}

function logdebug(message) {
  if(bDebug || settings.debug) {
    console.log(`${datetoISO(new Date())}- ${message}`)
  }
}

function toAsset(str) {
  return new Asset(str)
}

function getPostValue(post) {
  let value = toAsset(post.pending_payout_value).value;
  if (value == 0) {
    value = toAsset(post.total_payout_value).value + toAsset(post.curator_payout_value).value;
  }
  return value
}

async function createMap(lat, long, filename) {
  const apiKey = settings.google_maps_api_key
  const apiUrl = 'https://maps.googleapis.com/maps/api/staticmap'

  const zoom = '5'                                   // Zoom level (0-20)
  const size = '600x200'                             // Image size in pixels (max 640x640 for free accounts)
  const center = `${lat}, ${long}`                   // Latitude and longitude of the map's center
  const iconUrl = 'https://i.imgur.com/xv1Gr1d.png'  // 48x48
  const markers = `icon:${iconUrl}|${lat}, ${long}`  // Marker parameters

  const colorCountry = "0xffae3d"
  const colorCity = "0xe2b179"

  // const params = {
  //   center: center,
  //   zoom: zoom,
  //   size: size,
  //   markers: markers,
  //   style: "feature:road|visibility:simplified|feature:administrative.country|visibility:simplified|feature:administrative.locality|element:labels|visibility:off",
  //   key: apiKey
  // };

  const url = 
  `${apiUrl}?key=${apiKey}&center=${center}&markers=${markers}&zoom=${zoom}&size=${size}`+
  `&style=element:geometry%7Ccolor:0xf5f5f5`+
  `&style=element:labels%7Cvisibility:off`+
  `&style=element:labels.icon%7Cvisibility:off`+
  `&style=element:labels.text.fill%7Ccolor:0x616161`+
  `&style=element:labels.text.stroke%7Ccolor:0xf5f5f5`+
  `&style=feature:administrative%7Celement:geometry%7Cvisibility:off`+
  `&style=feature:administrative.country%7Celement:labels.text%7Ccolor:${colorCountry}%7Cvisibility:simplified%7Cweight:1`+
  `&style=feature:administrative.locality%7Ccolor:${colorCity}%7Cvisibility:simplified`+
  `&style=feature:administrative.land_parcel%7Celement:labels.text.fill%7Ccolor:0xbdbdbd`+
  `&style=feature:administrative.neighborhood%7Cvisibility:off`+
  `&style=feature:poi%7Cvisibility:off`+
  `&style=feature:poi%7Celement:geometry%7Ccolor:0xeeeeee`+
  `&style=feature:poi%7Celement:labels.text.fill%7Ccolor:0x757575`+
  `&style=feature:poi.park%7Celement:geometry%7Ccolor:0xe5e5e5`+
  `&style=feature:poi.park%7Celement:labels.text.fill%7Ccolor:0x9e9e9e`+
  `&style=feature:road%7Cvisibility:off`+
  `&style=feature:road%7Celement:geometry%7Ccolor:0xffffff`+
  `&style=feature:road%7Celement:labels.icon%7Cvisibility:off`+
  `&style=feature:road.arterial%7Celement:labels.text.fill%7Ccolor:0x757575`+
  `&style=feature:road.highway%7Celement:geometry%7Ccolor:0xdadada`+
  `&style=feature:road.highway%7Celement:labels.text.fill%7Ccolor:0x616161`+
  `&style=feature:road.local%7Celement:labels.text.fill%7Ccolor:0x9e9e9e`+
  `&style=feature:transit%7Cvisibility:off`+
  `&style=feature:transit.line%7Celement:geometry%7Ccolor:0xe5e5e5`+
  `&style=feature:transit.station%7Celement:geometry%7Ccolor:0xeeeeee`+
  `&style=feature:water%7Celement:geometry%7Ccolor:0xc9c9c9`+
  `&style=feature:water%7Celement:labels.text.fill%7Ccolor:0x9e9e9e`

  try {
    // const response = await axios.get(baseUrl, { params, responseType: 'arraybuffer' });
    const response = await axios.get(url, { responseType: 'arraybuffer' });

    if (response.status === 200) {
      fs.writeFileSync(`${settings.maps_folder}/${filename}`, response.data);
    } else {
      logerror(`createMap - Error: ${response.status} - ${response.statusText}`);
    }
  } catch (error) {
    logerror('createMap - Error fetching the map image:', error.message);
  }
}


async function processPost(post) {
  const postdate = post.created.toString().replace("T", " ");
  const code = post.body.match(REGEX_PIN)[0];
  const project = code.split(" ",1)[0]
  const lat = code.split(project)[1].split("lat")[0];
  const long = code.split("lat")[1].split("long")[0];
  const descr = code.split("long")[1].split("d3scr")[0].trim().slice(0,150);

  const permlink = post.permlink;
  const author = post.author;
  const posttitle = post.title;
  const json_metadata = JSON.parse(post.json_metadata);

  let postimg = "No image";;

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
        const imgreg = /src=['"]+.*?['"]+/g;
        if (post.body.match(imgreg)) {
          postimg = post.body.match(imgreg)[0];
        }
      }
    } else {
      const imgreg = /src=['"]+.*?['"]+/g;
      if (post.body.match(imgreg)) {
        postimg = post.body.match(imgreg)[0];
      }
    }
  } else {
    const imgreg = /src=['"]+.*?['"]+/g;
    if (post.body.match(imgreg)) {
      postimg = post.body.match(imgreg)[0];
    }
  }

  const postvalue = getPostValue(post)
  const tags = json_metadata.tags.toString().replaceAll(",",", ")

  if (
    lat != 0 &&
    long != 0 &&
    lat != undefined &&
    long != undefined
  ) {
      // Check if post already pinned
      const id = (await dbworldmappin.query(
      "SELECT id FROM markerinfo WHERE username = ? AND postPermLink = ? LIMIT 1",
      [author, permlink]
      ))[0]?.id

      if (undefined==id) {
        // new pin
        log(`new post @${post.author}/${post.permlink}`)

        const now = new Date().getTime()
        const filename = `${now}.png`
   
        const notification =
          `<div class="text-justify">` +
          `<b>Congratulations, your post has been added to <a href="https://worldmappin.com">The WorldMapPin Map</a>! 🎉</b><br><br>`+
          `<a href="https://worldmappin.com/p/${post.permlink}" target="_blank"><img src="https://worldmappin.com/maps/${filename}"/></a><br><br>` +
          `You can check out <b><a href="https://worldmappin.com/p/${post.permlink}" target="_blank">this post</a></b> and <b><a href="https://worldmappin.com/@${post.author}" target="_blank">your own profile</a></b> on the map. ` +
          `Be part of the <b><a href="https://peakd.com/c/hive-163772">Worldmappin Community</a></b> and join <b><a href="https://discord.gg/EGtBvSM">our Discord Channel</a></b> to get in touch with other travelers, ask questions or just be updated on our latest features.` +
          `</div>`

        try {
          await createMap(lat, long, filename);
          await dbworldmappin.query(
            `
            START TRANSACTION;
  
            INSERT INTO markerinfo (username, postTitle, longitude, lattitude, postDescription, postPermLink, postDate, tags, postUpvote, postValue, postImageLink, postBody, isCommented) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1);
  
            INSERT INTO notifications (parent_author, parent_permlink, body, json_metadata) 
            VALUES (?, ?, ?, ?);
  
            COMMIT;
            `,
            [
              // pin
              author, posttitle, long, lat, descr, permlink, postdate, tags, post.net_votes, postvalue, postimg, post.body,
              // notification
              author, permlink, notification, "",
            ]
          )
        } catch(e) {
          fs.unlink(`${settings.maps_folder}/${filename}`, (e) => { console.log(e.message) })
          throw e
        }
      } else {
        logdebug(`update post @${post.author}/${post.permlink}`)
        await dbworldmappin.query(
          `
            UPDATE markerinfo 
            SET postTitle = ?, longitude = ?, lattitude = ?, postDescription = ?, tags= ?, postUpvote= ?, postValue= ?, postImageLink= ?, postBody= ?
            WHERE id = ?
          `,
          [ 
            posttitle, long, lat, descr, tags, post.net_votes, postvalue, postimg, post.body,
            id
          ]
        )
      }
  } else {
    await dbworldmappin.query(
      "DELETE FROM markerinfo WHERE username = ? AND postPermlink = ?",
      [post.author, post.permlink]
    );
  }  
}

async function processVote(author, permlink, weight) {
  try {
    const reward = (await dbworldmappin.query(
      "SELECT postValue FROM markerinfo WHERE username = ? AND postPermLink = ? LIMIT 1",
      [author, permlink]))[0]?.postValue

    if (reward!=undefined && (reward < 0.02 || weight < 0)) {
      const post = await hiveClient.call("condenser_api","get_content",[author, permlink])
      await dbworldmappin.query(
        "UPDATE markerinfo SET postUpvote = ?, postValue = ? WHERE username = ? AND postPermLink = ?",
        [ post.net_votes, getPostValue(post), author, permlink]
      )
    }
  } catch (e) {
		logerror(`processVote failed: ${e.message}`, e.stack)
  }
}

async function checkUnpinPost(author, permlink) {

}

async function processOp(type,params) {
  try {
    switch(type) {
      case "comment":
        if(params.parent_author!="") return; // ignore comments

        // logdebug(`process post ${params.author} - ${params.permlink}`)
        let post = undefined

        if(params.body.startsWith("@@")) {
          // existing comment update - retrieve full body from the blockchain
          post = await hiveClient.call("condenser_api","get_content",[params.author, params.permlink])
          params.body = post.body
        }
        if (params.body.match(REGEX_PIN)) {
          // load post if not yet loaded
          if(undefined == post) {
            post = await hiveClient.call("condenser_api","get_content",[params.author, params.permlink])
          }
          await processPost(post)
        } else {
          // Check if post already pinned and need unpin
          await checkUnpinPost(params.author, params.permlink)
        }
        break;

      case "delete_comment":
        logdebug(`delete post ${params.author} - ${params.permlink}`)
        await checkUnpinPost(params.author, params.permlink)
        break;

      // case "vote":
      //     // logdebug(`vote ${params.author} - ${params.permlink}`)
      //     await processVote(params.author, params.permlink, params.weight)
      //     break;
      }
	} catch(e) {
		logerror(`processOp failed: ${e.message}`, JSON.stringify(op))
    throw e
	}
}

async function serviceNotifications() {
  if(bBusyNotifications) {
		// service is already running
		return
	}
  try {
    bBusyNotifications = true
    const notifications = (await dbworldmappin.query("SELECT * FROM notifications"))
    
    if (notifications.length) {
      for (const notification of notifications) {
        const now = new Date();
        const opComment = {
          author: settings.account,
          permlink: "wmp" + now.getTime().toString(),
          title: "",
          body: notification.body,
          parent_author: notification.parent_author,
          parent_permlink: notification.parent_permlink,
          json_metadata: notification.json_metadata,
        }
        const opVote = {
          voter: settings.account,
          author: notification.parent_author,
          permlink: notification.parent_permlink,
          weight: settings.upvote_weight * 100
        }  

        try {
          const { id } = await hiveClient.broadcast.comment(opComment, postingKey);
          log(`Notification sent to @${notification.parent_author} (${id})`);
        } catch(e) {
          if (e.message.includes("not found")) {
            await dbworldmappin.query("DELETE FROM markerinfo WHERE username = ? AND postPermlink = ?",[notification.parent_author, notification.parent_permlink]);
          } else {
            throw e
          }
        }
        await dbworldmappin.query("DELETE FROM notifications WHERE id = ?",[notification.id]);
        if(settings.upvote_comments) {
          await hiveClient.broadcast.vote(opVote, postingKey)
        }
        await wait(3 * msSecond);
      }
    }
  } catch (e) {
    logerror(`serviceNotifications failed: ${e.message}`, e.stack)
  } finally {
    bBusyNotifications = false    
  }
}

async function processBlock(block) {
  if (bDebug) {
    logdebug(`block: ${block_num} (${block.timestamp}) txs: ${block.transactions.length}`)
  } else if(bFirstBlock || block_num % 100 == 0) {
    log(`processing block ${block_num} (${block.timestamp})`)
  }
  bFirstBlock = false
  // Process txs
  for(const tx of block.transactions) {
    // console.debug(`\ttx: ${tx.transaction_num} - ops: ${tx.operations.length}`)
    // Process ops
    for(const op of tx.operations) {
      //console.debug(`\t\top: ${state.last_block_tx_op} ${JSON.stringify(op)}`)
      if(op.type!=undefined) {  // get_block_range format
        op.type = op.type.replace('_operation','')
        if(["comment","delete_comment"/*,"vote"*/].includes(op.type)) {
          await processOp(op.type, op.value)
        }
      } else { // get_block format
        if(["comment","delete_comment"/*,"vote"*/].includes(op[0])) {
          await processOp(op[0],op[1])
        }
      }
    }
  }
  await dbworldmappin.query(`UPDATE params SET last_block = ?`,[block_num])
  block_num++
}

async function service() {
  if(bBusy) {
		// service is already running
		return
	}
  try {
    bBusy = true

    block_num = (await dbworldmappin.query("SELECT last_block FROM  params LIMIT 1"))[0].last_block + 1

    // Check for massive sync
    const dgp = await hiveClient.database.getDynamicGlobalProperties()
    log(`Check massive - bn:${block_num} lib:${dgp.last_irreversible_block_num}`)
    while(block_num < dgp.last_irreversible_block_num) {
      const call = { id: 1, jsonrpc: "2.0", method: "block_api.get_block_range", params:{"starting_block_num": block_num, "count": 100} }
      const blocks = (await axios.post(settings.hive_api, call)).data.result.blocks
      for(const block of blocks) {
        await processBlock(block)
      }
    }
		// Stream blockchain
    await wait(3 * msSecond)
    log("Streaming blockchain")
		for await (const block of hiveClient.blockchain.getBlocks(block_num)) {
      await processBlock(block)
		}
  } catch (e) {
    if(e.message.toLowerCase().includes("database lock")) {
      log(e.message)
    } else {
      logerror(e.message)
    }
  } finally {
    bBusy = false
  }
}

async function test() {

  // block_num = 90081227
  // const call = { id: 1, jsonrpc: "2.0", method: "condenser_api.get_block", params:[block_num] }
  // const block = (await axios.post(settings.hive_api, call)).data.result
  // await processBlock(block)

  await service()
  //await serviceNotifications()

  // const params = {
  //   author: 'mahmoudtech0',
  //   permlink: 'can-artificial-intelligence-save-customer-service',
  // }
  // const post = await hiveClient.call("condenser_api","get_content",[params.author, params.permlink])
  // await processPost(post)

  // const lat = "43.50734", long = "16.43975"   // split
  // // const lat = "32.33617", long = "-117.05454" // rosarito
  // // const lat = "55.75586", long = "37.62030"   // moscow

  // const now = new Date().getTime()
  // const filename = `map.png`;                               // Output file name
  // await createMap(lat,long, filename);

  // service()
  // setInterval(service, settings.interval * 1000)
  // serviceNotifications()
  // setInterval(serviceNotifications, settings.interval * 1000)
}

(async () => {
  try {
    if(bDebug) {
      log("Debug started")
      log(`API: ${settings.hive_api}`)
      await test()
    } else {
      log("Service started")
      log(`Debug: ${settings.debug ? "active":"inactive"}`)
      log(`Interval: ${settings.interval.toString()} seconds`)
      log(`API: ${settings.hive_api}`)
      service()
      setInterval(service, settings.interval * 1000)
      serviceNotifications()
      setInterval(serviceNotifications, settings.interval * 1000)
    }
  } catch(e) {
    console.error(e)
  }
})();
