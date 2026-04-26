// Load .env so EXPO_PUBLIC_* vars are available
require('dotenv').config();

const appJson = require('./app.json');
module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo?.extra,
      eas: {
        projectId: 'be579bfe-141a-4c30-b12b-35ec3b059458',
      },
    },
  },
};
