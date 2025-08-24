const express = require('express');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.static('public'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/robit-auth', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// MongoDB connection event listeners
mongoose.connection.on('connected', () => {
  console.log('Connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

// MongoDB User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// In-memory storage for temporary data (keeping these since they're temporary)
const temporaryCodes = new Map(); // stores code -> timestamp
const pendingUsers = new Map(); // stores email -> user data
const emailCodes = new Map(); // stores email -> verification code

const SPECIAL_PASSWORD = process.env.SPECIAL_PASSWORD || 'Jd92ofjvcmkgfej837KJe';
const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const TEMP_CODE_EXPIRY = parseInt(process.env.TEMP_CODE_EXPIRY) || 5; // minutes
const EMAIL_CODE_EXPIRY = parseInt(process.env.EMAIL_CODE_EXPIRY) || 10; // minutes

// Configure nodemailer
const transporter = nodemailer.createTransporter({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Generate temporary code in format: number, lowercase, uppercase, lowercase, number, lowercase
function generateTempCode() {
  const numbers = '0123456789';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  
  return numbers.charAt(Math.floor(Math.random() * numbers.length)) +
         lowercase.charAt(Math.floor(Math.random() * lowercase.length)) +
         uppercase.charAt(Math.floor(Math.random() * uppercase.length)) +
         lowercase.charAt(Math.floor(Math.random() * lowercase.length)) +
         numbers.charAt(Math.floor(Math.random() * numbers.length)) +
         lowercase.charAt(Math.floor(Math.random() * lowercase.length));
}

// Generate 5-digit verification code
function generateVerificationCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

// Clean expired codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, timestamp] of temporaryCodes.entries()) {
    if (now - timestamp > TEMP_CODE_EXPIRY * 60 * 1000) {
      temporaryCodes.delete(code);
    }
  }
  
  // Clean expired email codes
  for (const [email, data] of emailCodes.entries()) {
    if (now - data.timestamp > EMAIL_CODE_EXPIRY * 60 * 1000) {
      emailCodes.delete(email);
    }
  }
}, 60000);

// Endpoint to generate temporary code
app.post('/code', (req, res) => {
  const { password } = req.body;
  
  if (password !== SPECIAL_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  const code = generateTempCode();
  temporaryCodes.set(code, Date.now());
  
  res.json({ code, expiresIn: `${TEMP_CODE_EXPIRY} minutes` });
});

// Serve registration page for temporary code
app.get('/:code', (req, res) => {
  const code = req.params.code;
  
  if (!temporaryCodes.has(code)) {
    return res.status(404).send('Invalid or expired code');
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Create Account - Robit</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                background: #f6f9fc;
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .container {
                background: white;
                border-radius: 12px;
                border: 1px solid #eaeaea;
                padding: 40px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #375dfb;
                margin-bottom: 30px;
                text-align: center;
            }
            h1 {
                color: #111827;
                font-size: 24px;
                margin-bottom: 8px;
                text-align: center;
            }
            p {
                color: #6b7280;
                font-size: 14px;
                margin-bottom: 20px;
                text-align: center;
            }
            input {
                width: 100%;
                padding: 12px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                font-size: 16px;
                margin-bottom: 15px;
                box-sizing: border-box;
            }
            input:focus {
                outline: none;
                border-color: #375dfb;
                box-shadow: 0 0 0 3px rgba(55, 93, 251, 0.1);
            }
            button {
                width: 100%;
                padding: 12px;
                background: #375dfb;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                font-weight: 600;
            }
            button:hover {
                background: #2d4ed8;
            }
            button:disabled {
                background: #9ca3af;
                cursor: not-allowed;
            }
            .message {
                margin-top: 15px;
                padding: 10px;
                border-radius: 6px;
                text-align: center;
            }
            .success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
            .error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">Robit</div>
            <h1>Create Account</h1>
            <p>Enter your details to create a new account</p>
            
            <form id="registerForm">
                <input type="text" id="username" placeholder="Username" required>
                <input type="email" id="email" placeholder="Email" required>
                <input type="password" id="password" placeholder="Password" required>
                <button type="submit">Create Account</button>
            </form>
            
            <div id="message"></div>
        </div>

        <script>
            document.getElementById('registerForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const username = document.getElementById('username').value;
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const messageDiv = document.getElementById('message');
                
                try {
                    const response = await fetch('/register', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            username,
                            email,
                            password,
                            tempCode: '${code}'
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok) {
                        messageDiv.innerHTML = '<div class="success">Verification email sent! Check your inbox.</div>';
                        document.getElementById('registerForm').style.display = 'none';
                    } else {
                        messageDiv.innerHTML = '<div class="error">' + result.error + '</div>';
                    }
                } catch (error) {
                    messageDiv.innerHTML = '<div class="error">Network error. Please try again.</div>';
                }
            });
        </script>
    </body>
    </html>
  `);
});

// Registration endpoint
app.post('/register', async (req, res) => {
  const { username, email, password, tempCode } = req.body;
  
  // Validate temporary code
  if (!temporaryCodes.has(tempCode)) {
    return res.status(400).json({ error: 'Invalid or expired registration code' });
  }
  
  try {
    // Check if username already exists in MongoDB
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Check if email already exists in MongoDB
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already in use' });
    }
    
    // Check if email is already pending
    if (pendingUsers.has(email)) {
      return res.status(400).json({ error: 'Email verification already pending' });
    }
    
    // Generate email verification code
    const verificationCode = generateVerificationCode();
    
    // Store pending user (temporarily until email verified)
    pendingUsers.set(email, {
      username,
      email,
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      timestamp: Date.now()
    });
    
    emailCodes.set(email, {
      code: verificationCode,
      timestamp: Date.now()
    });
  
  // Read and customize email template
  const emailTemplate = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <title>Robit Verification Code</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100% !important; width: 100% !important; }
      * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
      a { text-decoration: none; }

      @media (prefers-color-scheme: dark) {
        body, .bg-body { background: #0b0c0f !important; }
        .card { background: #12151a !important; border-color: #232a33 !important; }
        .text-main { color: #e6edf3 !important; }
        .text-muted { color: #9aa7b4 !important; }
        .brand { color: #8fb4ff !important; }
        .code-box { background: #0b0c0f !important; border-color: #2a323d !important; color: #ffffff !important; }
      }

      @media screen and (max-width: 600px) {
        .container { width: 100% !important; }
        .px-sm { padding-left: 16px !important; padding-right: 16px !important; }
        .stack { display: block !important; width: 100% !important; }
      }
    </style>
  </head>
  <body class="bg-body" style="background-color:#f6f9fc;">
    <div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
      Your Robit verification code is ${verificationCode}.
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f6f9fc;">
      <tr>
        <td align="center" class="px-sm" style="padding: 32px 24px;">

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container card" style="width:600px; max-width:600px; background:#ffffff; border:1px solid #eaeaea; border-radius:12px;">
            <tr>
              <td style="padding: 28px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="left" class="brand" style="font-family:-apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:20px; font-weight:700; color:#375dfb;">
                      <img src="https://files.catbox.moe/h5jhr4.png" alt="Robit Logo" width="120" style="display:block;">
                    </td>
                    <td align="right" class="stack" style="font-family:-apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:12px; color:#666;">
                      <a href="#" style="color:#666;">View in browser</a>
                    </td>
                  </tr>
                </table>

                <h1 class="text-main" style="margin:24px 0 8px 0; font-family:-apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:24px; line-height:1.3; color:#111827;">
                  Your verification code
                </h1>
                <p class="text-muted" style="margin:0; font-family:-apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:14px; line-height:1.6; color:#6b7280;">
                  Use the code below to continue with Robit. If you didn't request this, you can safely ignore this email.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;">
                  <tr>
                    <td align="center" class="code-box" style="font-family: SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size:28px; letter-spacing:6px; color:#111827; padding:18px 12px; background:#f4f6f8; border:1px solid #e5e7eb; border-radius:10px;">
                      ${verificationCode}
                    </td>
                  </tr>
                </table>

                <p class="text-muted" style="margin:20px 0 0 0; font-family:-apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:12px; line-height:1.6; color:#6b7280;">
                  For your security, never share this code with anyone.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-top:1px solid #e5e7eb; height:1px; line-height:1px; font-size:0;">&nbsp;</td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
                  <tr>
                    <td class="text-muted" style="font-family:-apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:12px; color:#6b7280;">
                      This email was sent by Robit.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </body>
</html>`;
  
  // Send verification email
  try {
    await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'Robit'}" <${process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Robit Verification Code',
      html: emailTemplate
    });
    
    res.json({ message: 'Verification email sent' });
  } catch (emailError) {
    console.error('Email error:', emailError);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Email verification endpoint
app.post('/verify-email', async (req, res) => {
  const { email, code } = req.body;
  
  const emailData = emailCodes.get(email);
  const pendingUser = pendingUsers.get(email);
  
  if (!emailData || !pendingUser) {
    return res.status(400).json({ error: 'Invalid verification request' });
  }
  
  if (emailData.code !== code) {
    return res.status(400).json({ error: 'Invalid verification code' });
  }
  
  try {
    // Create the user account in MongoDB
    const newUser = new User({
      username: pendingUser.username,
      email: pendingUser.email,
      password: pendingUser.password
    });
    
    await newUser.save();
    
    // Clean up temporary data
    pendingUsers.delete(email);
    emailCodes.delete(email);
    
    res.json({ message: 'Account created successfully' });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// User authentication endpoint
app.get('/userpass/:username/:password', async (req, res) => {
  const { username, password } = req.params;
  
  try {
    // Find user in MongoDB
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.json({ valid: false, message: 'Username not found' });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return res.json({ valid: false, message: 'Incorrect password' });
    }
    
    res.json({ valid: true, message: 'Authentication successful' });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ valid: false, message: 'Authentication failed' });
  }
});

// Email verification page
app.get('/verify/:email', (req, res) => {
  const email = req.params.email;
  
  if (!pendingUsers.has(email)) {
    return res.status(404).send('Invalid verification link');
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Email - Robit</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                background: #f6f9fc;
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .container {
                background: white;
                border-radius: 12px;
                border: 1px solid #eaeaea;
                padding: 40px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #375dfb;
                margin-bottom: 30px;
                text-align: center;
            }
            h1 {
                color: #111827;
                font-size: 24px;
                margin-bottom: 8px;
                text-align: center;
            }
            p {
                color: #6b7280;
                font-size: 14px;
                margin-bottom: 20px;
                text-align: center;
            }
            input {
                width: 100%;
                padding: 12px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                font-size: 16px;
                margin-bottom: 15px;
                box-sizing: border-box;
                text-align: center;
                letter-spacing: 2px;
            }
            input:focus {
                outline: none;
                border-color: #375dfb;
                box-shadow: 0 0 0 3px rgba(55, 93, 251, 0.1);
            }
            button {
                width: 100%;
                padding: 12px;
                background: #375dfb;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                font-weight: 600;
            }
            button:hover {
                background: #2d4ed8;
            }
            .message {
                margin-top: 15px;
                padding: 10px;
                border-radius: 6px;
                text-align: center;
            }
            .success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
            .error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">Robit</div>
            <h1>Verify Email</h1>
            <p>Enter the verification code sent to your email</p>
            
            <form id="verifyForm">
                <input type="text" id="code" placeholder="Enter 5-digit code" maxlength="5" required>
                <button type="submit">Verify</button>
            </form>
            
            <div id="message"></div>
        </div>

        <script>
            document.getElementById('verifyForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const code = document.getElementById('code').value;
                const messageDiv = document.getElementById('message');
                
                try {
                    const response = await fetch('/verify-email', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            email: '${email}',
                            code: code
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok) {
                        messageDiv.innerHTML = '<div class="success">Account verified successfully!</div>';
                        document.getElementById('verifyForm').style.display = 'none';
                    } else {
                        messageDiv.innerHTML = '<div class="error">' + result.error + '</div>';
                    }
                } catch (error) {
                    messageDiv.innerHTML = '<div class="error">Network error. Please try again.</div>';
                }
            });
        </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
  console.log('Available endpoints:');
  console.log('POST /code - Generate temporary registration code');
  console.log('GET /:code - Registration page');
  console.log('POST /register - Register new user');
  console.log('POST /verify-email - Verify email with code');
  console.log('GET /userpass/:username/:password - Authenticate user');
});
