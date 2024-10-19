const settings = require("./settings.js")

const { Asset } = require("./asset.js")
const { Client, PrivateKey } = require('@hiveio/dhive')
const hiveClient = new Client(settings.hive_api);

// Initialize nodemailer
const nodemailer = require("nodemailer");
const email = settings.email;
const smtp = nodemailer.createTransport({
  host: email.smtp,
  port: email.port,
  secure: false,
  ignoreTLS: true
})

// Initialize global variables
const bDebug = process.env.DEBUG==="true"
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

async function processPost(post) {
  const postdate = post.created.toString().replace("T", " ");
  const code = post.body.match(REGEX_PIN)[0];
  const project = code.split(" ",1)[0]
  const lat = code.split(project)[1].split("lat")[0];
  const long = code.split("lat")[1].split("long")[0];
  const descr = code.split("long")[1].split("d3scr")[0].trim().slice(0,150);

  const permlink = post.permlink;
  const author = post.author;
  const postlink = "https://peakd.com" + post.url;
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

        // const notification =
        //   '<b>Congratulations, your post has been added to <a href="https://worldmappin.com">WorldMapPin</a>! 🎉</b><br/><br>'+
        //   `Did you know you have <b><a href="https://worldmappin.com/@${pa}" target="_blank">your own profile map</a></b>?<br>` +
        //   `And every <b><a href="https://worldmappin.com/p/${pp}" target="_blank">post has their own map</a></b> too!<br/><br/>` +
        //   '<b>Want to have your post on the map too?</b><br/><ul><li>Go to <b><a href="https://worldmappin.com">WorldMapPin</a></b></li>'+
        //   '<li>Click the <b>get code</b> button</li><li>Click on the map where your post should be (zoom in if needed)</li>'+
        //   '<li>Copy and paste the generated code in your post (Hive only)</li><li>Congrats, your post is now on the map!</li></ul>'+
        //   '<a href="https://peakd.com/@worldmappin" target="_blank"><img src="https://worldmappin.com/notify.png?1"/></a>';

        const notification =
          `<div class="text-justify">` +
          `<b>Congratulations, your post has been added to <a href="https://worldmappin.com">The WorldMapPin Map</a>! 🎉</b><br/><br>` +
          `You can check out <b><a href="https://worldmappin.com/p/${post.permlink}" target="_blank">this post</a></b> and <b><a href="https://worldmappin.com/@${post.author}" target="_blank">your own profile</a></b> on the map. ` +
          `Be part of the <b><a href="https://peakd.com/c/hive-163772">Worldmappin Community</a></b> and join <b><a href="https://discord.gg/EGtBvSM">our Discord Channel</a></b> to get in touch with other travelers, ask questions or just be updated on our latest features.` +
          `</div>`
      
        await dbworldmappin.query(
          `
          START TRANSACTION;

          INSERT INTO markerinfo (postLink, username, postTitle, longitude, lattitude, postDescription, postPermLink, postDate, tags, postUpvote, postValue, postImageLink, postBody, isCommented) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1);

          INSERT INTO notifications (parent_author, parent_permlink, body, json_metadata) 
          VALUES (?, ?, ?, ?);

          COMMIT;
          `,
          [
            // pin
            postlink, author, posttitle, long, lat, descr, permlink, postdate, tags, post.net_votes, postvalue, postimg, post.body,
            // notification
            author, permlink, notification, "",
          ]
        )
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
      [author.toString(), permlink.toString()]))[0]?.postValue

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

async function processOp(op) {
  try {
    const params = op[1]
    switch(op[0]) {
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

      case "vote":
          // logdebug(`vote ${params.author} - ${params.permlink}`)
          await processVote(params.author, params.permlink, params.weight)
          break;
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

async function service() {
  if(bBusy) {
		// service is already running
		return
	}
  try {
    bBusy = true

    const last_block = (await dbworldmappin.query("SELECT last_block FROM  params LIMIT 1"))[0].last_block
    const state = { last_block: last_block, last_block_tx: 0, last_block_tx_op: 0 }

		// Process blocks
		for await (const block of hiveClient.blockchain.getBlocks(state.last_block)) {
			if (bDebug) {
				logdebug(`block: ${state.last_block} (${block.timestamp}) txs: ${block.transactions.length}`)
			} else if(bFirstBlock || state.last_block % 100 == 0) {
				log(`processing block ${state.last_block} (${block.timestamp})`)
			}
			bFirstBlock = false
			// Process txs
			for(let itx=state.last_block_tx; itx < block.transactions.length; itx++) {
				const tx = block.transactions[itx]
				// console.debug(`\ttx: ${tx.transaction_num} - ops: ${tx.operations.length}`)
				// Process ops
				for(let iop=state.last_block_tx_op; iop < tx.operations.length; iop++) {
					const op = tx.operations[iop]
					//console.debug(`\t\top: ${state.last_block_tx_op} ${JSON.stringify(op)}`)
					if(["comment","delete_comment","vote"].includes(op[0])) {
						await processOp(op)
					}
					// op processed
					state.last_block_tx_op += 1
				}
				// tx processed
				state.last_block_tx_op = 0
				state.last_block_tx += 1
			}
			// block processed
			state.last_block_tx = 0
			state.last_block += 1
      await dbworldmappin.query(`UPDATE params SET last_block = ?`,[state.last_block])
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
    //await service()
    // await serviceNotifications()

    service()
    setInterval(service, settings.interval * 1000)
    serviceNotifications()
    setInterval(serviceNotifications, settings.interval * 1000)
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
