const util = require("util");
const mysql = require("mysql");
const settings = require("./settings.js")

const pool = mysql.createPool({
    host: settings.mysql.host,
    database: settings.mysql.database,
    user: settings.mysql.user,
    password: settings.mysql.password,
    multipleStatements: true,
    charset: "utf8mb4",
});

pool.getConnection((err, connection) => {
    if (err) {
        if (err.code === "PROTOCOL_CONNECTION_LOST") {
            console.error("Database connection was closed.");
        }
        if (err.code === "ER_CON_COUNT_ERROR") {
            console.error("Database has too many connections.");
        }
        if (err.code === "ECONNREFUSED") {
            console.error("Database connection was refused.");
        }
    }
    if (connection) connection.release();
    return;
});

pool.query = util.promisify(pool.query);

module.exports = pool;