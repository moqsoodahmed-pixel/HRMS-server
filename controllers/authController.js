const jwt = require('jsonwebtoken');
const User = require('../models/User');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_SESSION_EXPIRES_IN || '30m',
  });

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.COOKIE_CROSS_SITE === 'true' ? 'None' : 'Lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required' });

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!user.isActive)
      return res.status(403).json({ success: false, message: 'Account is inactive' });

    const token = signToken(user._id);
    res.cookie('token', token, cookieOptions());

    return res.json({ success: true, data: user.toJSON() });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.logout = (_req, res) => {
  res.clearCookie('token');
  return res.json({ success: true, message: 'Logged out' });
};

exports.getMe = async (req, res) => {
  return res.json({ success: true, data: req.user });
};
