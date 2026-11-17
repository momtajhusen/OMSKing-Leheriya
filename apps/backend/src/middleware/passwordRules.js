const { body } = require('express-validator');
const { PASSWORD_MIN } = require('../lib/password');

const passwordRules = () => [
  body('password')
    .isLength({ min: PASSWORD_MIN }).withMessage(`Password must be at least ${PASSWORD_MIN} characters`)
    .matches(/[A-Z]/).withMessage('Add at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Add at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Add at least one number')
    .matches(/[^A-Za-z0-9]/).withMessage('Add at least one special character, like ! @ # or -'),
];

module.exports = { passwordRules };
