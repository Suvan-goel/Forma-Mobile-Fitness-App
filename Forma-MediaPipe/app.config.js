// Load .env so EXPO_PUBLIC_* vars are available
require('dotenv').config();

const appJson = require('./app.json');
module.exports = {
  ...appJson,
};
