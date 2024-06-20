const settings = require("./settings.js")
const sql = require("mssql")

exports.getComments = function() {
	return new sql.ConnectionPool(settings.sql)
	.connect()
	.then(pool => {
		return pool
		.request()
		.query("SELECT name FROM QueueInterests WHERE timestamp IS NULL OR timestamp <= GETUTCDATE()")
	})
	.then(result => {
		sql.close()
		return result.recordsets[0]
	})
	.catch(error => {
		console.log(error)
		sql.close()
	})
}
