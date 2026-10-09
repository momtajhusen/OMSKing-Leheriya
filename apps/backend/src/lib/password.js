const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

module.exports = { hashPassword, BCRYPT_COST };
