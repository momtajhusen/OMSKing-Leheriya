const { body } = require('express-validator');

const passwordRules = () => [
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Add at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Add at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Add at least one number'),
];

module.exports = { passwordRules };
