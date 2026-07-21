const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

process.env.PORT = process.env.PORT || 3001;
process.env.NODE_ENV = process.env.NODE_ENV || 'dev';
