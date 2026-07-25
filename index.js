const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('os').platform() === 'win32' ? require('path').win32 : require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

// --- Anti-Crash Global Safety Handlers ---
process.on('uncaughtException', (err) => {
  console.error('[Global Safe Handler] Uncaught Exception:', err?.message || err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Global Safe Handler] Unhandled Rejection:', reason);
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Cloud Data Storage Directory
const USER_DATA_DIR = process.env.RENDER
  ? path.join(__dirname, 'data')
  : path.join(os.homedir(), '.reach-companion');

if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

const GLOBAL_STATE_FILE = path.join(USER_DATA_DIR, 'global_state.json');
const PROFILES_DIR = path.join(USER_DATA_DIR, 'profiles');

const getActiveProfile = () => {
  if (fs.existsSync(GLOBAL_STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(GLOBAL_STATE_FILE, 'utf-8'));
      if (state.activeProfile) return state.activeProfile;
    } catch (e) {}
  }
  return 'default';
};

const saveActiveProfile = (profile) => {
  try {
    fs.writeFileSync(GLOBAL_STATE_FILE, JSON.stringify({ activeProfile: profile }, null, 2));
  } catch (e) {}
};

let activeProfile = getActiveProfile();

const getProfilePath = (fileName) => {
  const profileDir = path.join(PROFILES_DIR, activeProfile);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  return path.join(profileDir, fileName);
};

const getTokensFile = () => getProfilePath('tokens.json');
const getTemplatesFile = () => getProfilePath('templates.json');
const getDiscoveredPostsFile = () => getProfilePath('discovered_posts.json');
const getConfigFile = () => getProfilePath('config.json');
const getSentLogsFile = () => getProfilePath('sent_logs.json');

// Restore initial default profile files if missing
const migrateExistingToDefault = () => {
  const defaultDir = path.join(PROFILES_DIR, 'default');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  const files = ['config.json', 'tokens.json', 'templates.json', 'discovered_posts.json'];
  const possibleSrcDirs = [
    path.join(__dirname, 'data', 'profiles', 'default'),
    path.join(__dirname, '..', 'backend'),
    __dirname
  ];

  files.forEach(f => {
    const dest = path.join(defaultDir, f);
    const srcInBundle = path.join(__dirname, 'data', 'profiles', 'default', f);
    
    // Always overwrite if source bundle file exists to guarantee persistence on Render deploys
    if (fs.existsSync(srcInBundle)) {
      try {
        fs.copyFileSync(srcInBundle, dest);
        console.log(`Loaded bundled ${f} into profiles/default/`);
        return;
      } catch (err) {}
    }

    if (!fs.existsSync(dest)) {
      for (const srcDir of possibleSrcDirs) {
        const src = path.join(srcDir, f);
        if (fs.existsSync(src)) {
          try {
            fs.copyFileSync(src, dest);
            console.log(`Migrated ${f} to profiles/default/`);
            break;
          } catch (err) {}
        }
      }
    }
  });
};

migrateExistingToDefault();

// Helper binaries resolver
const home = os.homedir();
const isWin = os.platform() === 'win32';
const TWITTER_PATH = isWin ? path.join(home, '.agent-reach-venv', 'Scripts', 'twitter.exe') : 'twitter';
const REDDIT_PATH = isWin ? path.join(home, '.agent-reach-venv', 'Scripts', 'rdt.exe') : 'rdt';

const runCli = (cmd, args, envVars = {}) => {
  return new Promise((resolve) => {
    const pyPkgPath = path.join(__dirname, 'python_packages');
    const userPyPaths = [
      path.join(home, '.local', 'lib', 'python3.10', 'site-packages'),
      path.join(home, '.local', 'lib', 'python3.11', 'site-packages'),
      path.join(home, '.local', 'lib', 'python3.12', 'site-packages'),
      path.join(home, '.local', 'lib', 'python3.13', 'site-packages')
    ].join(':');
    const existingPyPath = process.env.PYTHONPATH || '';
    const fullPyPath = `${pyPkgPath}:${userPyPaths}${existingPyPath ? ':' + existingPyPath : ''}`;
    const options = {
      env: { 
        ...process.env, 
        PYTHONPATH: fullPyPath,
        PATH: `${path.join(home, '.local', 'bin')}:${process.env.PATH}`,
        ...envVars 
      },
      maxBuffer: 10 * 1024 * 1024
    };
    execFile(cmd, args, options, (error, stdout, stderr) => {
      resolve({ stdout: stdout ? stdout.trim() : '', stderr: stderr ? stderr.trim() : '', error });
    });
  });
};

const getTokensData = () => {
  const file = getTokensFile();
  if (!fs.existsSync(file)) {
    return { activeTwitterTokenId: null, activeRedditTokenId: null, tokens: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!data.tokens) data.tokens = [];
    return data;
  } catch (e) {
    return { activeTwitterTokenId: null, activeRedditTokenId: null, tokens: [] };
  }
};

const saveTokensData = (data) => {
  fs.writeFileSync(getTokensFile(), JSON.stringify(data, null, 2));
};

const getTemplatesData = () => {
  const file = getTemplatesFile();
  if (!fs.existsSync(file)) return { templates: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return { templates: [] };
  }
};

const saveTemplatesData = (data) => {
  fs.writeFileSync(getTemplatesFile(), JSON.stringify(data, null, 2));
};

const getDiscoveredPosts = () => {
  const file = getDiscoveredPostsFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return [];
  }
};

const saveDiscoveredPosts = (posts) => {
  fs.writeFileSync(getDiscoveredPostsFile(), JSON.stringify(posts, null, 2));
};

const getSentLogs = () => {
  const file = getSentLogsFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return [];
  }
};

const saveSentLogs = (logs) => {
  fs.writeFileSync(getSentLogsFile(), JSON.stringify(logs, null, 2));
};

const getConfig = () => {
  const file = getConfigFile();
  if (!fs.existsSync(file)) {
    return { 
      keywords: ['hiring video editor', 'need video editor', 'looking for editor', 'need thumbnail', 'looking for thumbnail', 'hiring thumbnail'], 
      excludes: ['?'], 
      intervalMinutes: 5,
      autoOutreachEnabled: true,
      xActionConfig: 'both'
    };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (cfg.autoOutreachEnabled === undefined) cfg.autoOutreachEnabled = true;
    cfg.xActionConfig = 'comment';
    return cfg;
  } catch (e) {
    return { 
      keywords: ['hiring video editor', 'need video editor', 'looking for editor', 'need thumbnail', 'looking for thumbnail', 'hiring thumbnail'], 
      excludes: ['?'], 
      intervalMinutes: 5,
      autoOutreachEnabled: true,
      xActionConfig: 'comment'
    };
  }
};

const saveConfig = (cfg) => {
  fs.writeFileSync(getConfigFile(), JSON.stringify(cfg, null, 2));
};

// --- Scrapers ---
const parseKeywords = (queryStr) => {
  if (!queryStr) return { keywords: [], redditQuery: '', twitterQuery: '' };
  const rawList = queryStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
  return {
    keywords: rawList,
    redditQuery: rawList.join(' OR '),
    twitterQuery: rawList.map(k => `"${k}"`).join(' OR ')
  };
};

const scrapeTwitterCli = async (keywords, hours, tokenValue, ct0Value, excludeKeywords = []) => {
  if (!keywords || keywords.length === 0 || !tokenValue) return [];
  const allTweetsMap = new Map();
  const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

  for (const keyword of keywords) {
    const args = ['search', keyword, '--type', 'latest', '--json'];
    const envs = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TWITTER_AUTH_TOKEN: tokenValue };
    if (ct0Value) envs.TWITTER_CT0 = ct0Value;

    try {
      let stdout = '';
      let { stdout: out1, error: err1 } = await runCli(TWITTER_PATH, args, envs);
      stdout = out1;

      // Fallback 1: Run via python3 module
      if (!stdout || err1) {
        let { stdout: out2 } = await runCli('python3', ['-m', 'twitter_cli.cli', ...args], envs);
        stdout = out2;
      }
      // Fallback 2: Check ~/.local/bin/twitter
      if (!stdout) {
        const altPath = path.join(home, '.local', 'bin', 'twitter');
        let { stdout: out3 } = await runCli(altPath, args, envs);
        stdout = out3;
      }

      if (!stdout) continue;
      let parsed = JSON.parse(stdout);
      let tweets = Array.isArray(parsed) ? parsed : (parsed?.data || []);

      tweets.forEach(tweet => {
        const text = tweet.text || '';
        const lowerText = text.toLowerCase();
        if (excludeKeywords.some(ex => lowerText.includes(ex))) return;
        const isoString = tweet.createdAtISO || tweet.created_at;
        const postTime = isoString ? new Date(isoString).getTime() : 0;

        if (postTime >= cutoffTime) {
          const mappedTweet = {
            id: `twitter_${tweet.id}`,
            platform: 'twitter',
            time: isoString ? new Date(isoString).toISOString() : new Date().toISOString(),
            postTime,
            userProfile: {
              name: tweet.author?.name || 'Twitter User',
              handle: tweet.author?.screenName ? `@${tweet.author.screenName}` : '@twitter',
              image: tweet.author?.profileImageUrl || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'
            },
            text,
            postUrl: tweet.author?.screenName ? `https://x.com/${tweet.author.screenName}/status/${tweet.id}` : `https://x.com/status/${tweet.id}`,
            dmUrl: tweet.author?.screenName ? `https://x.com/messages/compose?recipient_id=${tweet.author.screenName}` : 'https://x.com/messages'
          };
          allTweetsMap.set(mappedTweet.id, mappedTweet);
        }
      });
    } catch (err) {}
  }
  return Array.from(allTweetsMap.values());
};

const scrapeRedditNative = (keyword) => {
  return new Promise((resolve) => {
    const https = require('https');
    const url = `https://old.reddit.com/search.rss?q=${encodeURIComponent(keyword)}&sort=new`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const posts = [];
        try {
          const blocks = data.split('<entry>');
          for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i].split('</entry>')[0];
            const titleMatch = block.match(/<title>([^<]+)<\/title>/);
            const linkMatch = block.match(/href="([^"]+)"/);
            const authorMatch = block.match(/<name>([^<]+)<\/name>/);
            const updatedMatch = block.match(/<updated>([^<]+)<\/updated>/);

            const title = titleMatch ? titleMatch[1] : '';
            const postUrl = linkMatch ? linkMatch[1] : '';
            const rawAuthor = authorMatch ? authorMatch[1] : '';
            const author = rawAuthor.replace('/u/', '').replace('u/', '');
            const postTime = updatedMatch ? new Date(updatedMatch[1]).getTime() : Date.now();

            if (title && postUrl) {
              const postId = 'reddit_' + Buffer.from(postUrl).toString('hex').substring(0, 16);
              posts.push({
                id: postId,
                platform: 'reddit',
                time: new Date(postTime).toISOString(),
                postTime,
                userProfile: {
                  name: author || 'Reddit User',
                  handle: `u/${author || 'user'}`,
                  image: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png'
                },
                text: title,
                postUrl,
                dmUrl: `https://www.reddit.com/message/compose/?to=${author}`
              });
            }
          }
        } catch(e) {}
        resolve(posts);
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
};

const scrapeRedditCli = async (keywords, hours, tokenValue) => {
  if (!keywords || keywords.length === 0) return [];
  const allPostsMap = new Map();
  const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

  for (const keyword of keywords) {
    const args = ['search', keyword, '--type', 'new', '--json'];
    const envs = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    if (tokenValue) envs.REDDIT_SESSION = tokenValue;

    try {
      let stdout = '';
      let { stdout: out1, error: err1 } = await runCli(REDDIT_PATH, args, envs);
      stdout = out1;

      // Fallback 1: Run via python3 module
      if (!stdout || err1) {
        let { stdout: out2 } = await runCli('python3', ['-m', 'rdt_cli', ...args], envs);
        stdout = out2;
      }

      let posts = [];
      if (stdout) {
        try {
          let listing = JSON.parse(stdout);
          posts = Array.isArray(listing) ? listing : (listing?.items || listing?.data || []);
        } catch(e) {}
      }

      // Native Node RSS Fallback for 100% Cloud Execution
      if (posts.length === 0) {
        const nativePosts = await scrapeRedditNative(keyword);
        nativePosts.forEach(p => allPostsMap.set(p.id, p));
        continue;
      }

      posts.forEach(post => {
        const postTime = (post.created_utc || 0) * 1000;
        if (postTime >= cutoffTime) {
          const mappedPost = {
            id: `reddit_${post.id}`,
            platform: 'reddit',
            time: new Date(postTime).toISOString(),
            postTime,
            userProfile: {
              name: post.author || 'Reddit User',
              handle: `u/${post.author}`,
              image: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png'
            },
            text: post.title + (post.selftext ? `\n${post.selftext}` : ''),
            postUrl: `https://www.reddit.com${post.permalink}`,
            dmUrl: `https://www.reddit.com/message/compose/?to=${post.author}`
          };
          allPostsMap.set(mappedPost.id, mappedPost);
        }
      });
    } catch (err) {
      const nativePosts = await scrapeRedditNative(keyword);
      nativePosts.forEach(p => allPostsMap.set(p.id, p));
    }
  }
  return Array.from(allPostsMap.values());
};

// --- Telegram Bot Notifications Helper ---
const TELEGRAM_BOT_TOKEN = '8911468384:AAGT7-Jn5FCPUEUSghEBLT8Jth6_-i-80fw';
let telegramChatId = null;
let hasSentWelcomeMessage = false;
let lastTelegramUpdateId = 0;

const sendTelegramMessage = (text) => {
  if (!telegramChatId) return;
  const https = require('https');
  const payload = JSON.stringify({ chat_id: telegramChatId, text, parse_mode: 'HTML' });
  const req = https.request(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();
};

const pollTelegramChatId = () => {
  const https = require('https');
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastTelegramUpdateId + 1}`;
  const req = https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.ok && json.result && json.result.length > 0) {
          json.result.forEach(update => {
            if (update.update_id > lastTelegramUpdateId) {
              lastTelegramUpdateId = update.update_id;
            }
            const chatId = update?.message?.chat?.id || update?.channel_post?.chat?.id;
            if (chatId) telegramChatId = chatId;
          });

          if (telegramChatId && !hasSentWelcomeMessage) {
            hasSentWelcomeMessage = true;
            console.log(`[Telegram Bot] Connected to user Chat ID: ${telegramChatId}`);
            sendTelegramMessage('🟢 <b>ReachCompanion Telegram Bot Connected!</b>\n\nYou will receive live notifications here whenever an auto-comment is posted or a reply is received!');
          }
        }
      } catch (e) {}
    });
  });
  req.on('error', (err) => {});
};

setInterval(pollTelegramChatId, 10000);
pollTelegramChatId();

const sendNativeTwitterComment = async (authToken, ct0Token, tweetId, message) => {
  const https = require('https');
  const querystring = require('querystring');
  const postData = querystring.stringify({
    status: message,
    in_reply_to_status_id: tweetId,
    auto_populate_reply_metadata: 'true'
  });

  const bearerToken = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAn%2BFWskAAAGC%2FGMGeWch9P601W%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F';

  return new Promise((resolve, reject) => {
    const req = https.request('https://x.com/i/api/1.1/statuses/update.json', {
      method: 'POST',
      headers: {
        'authorization': bearerToken,
        'cookie': `auth_token=${authToken}; ct0=${ct0Token}`,
        'x-csrf-token': ct0Token,
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(postData),
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch(e) {
            resolve({ status: 'ok' });
          }
        } else {
          reject(new Error(`Twitter API HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
};

// --- Execution Dispatch Helper ---
const executeActionForPost = async (post, xActionConfig = 'comment') => {
  const templatesData = getTemplatesData();
  if (templatesData.templates.length === 0) {
    throw new Error('No DM templates configured.');
  }

  // Switch templates completely randomly across all templates
  const templateObj = templatesData.templates[Math.floor(Math.random() * templatesData.templates.length)];

  const message = templateObj.text
    .replace(/{username}/g, post.userProfile?.name || '')
    .replace(/{handle}/g, post.userProfile?.handle || '');

  const tokens = getTokensData();
  const activeTwitter = tokens.tokens.find(t => t.id === tokens.activeTwitterTokenId);
  const activeReddit = tokens.tokens.find(t => t.id === tokens.activeRedditTokenId);

  if (post.platform === 'reddit') {
    if (!activeReddit || !activeReddit.value) throw new Error('No active Reddit session token');
    const postName = post.id.replace('reddit_', '');
    const args = ['comment', postName, message];
    const { stdout, error, stderr } = await runCli(REDDIT_PATH, args, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
    if (error) throw new Error(stderr || error.message);
    return { status: 'sent', action: 'comment', message };
  } else {
    // Twitter / X
    if (!activeTwitter || !activeTwitter.value) throw new Error('No active Twitter token');
    const screenName = (post.userProfile?.handle || '').replace('@', '');
    const bareTweetId = post.id.replace('twitter_', '');
    const doDM = (xActionConfig === 'dm' || xActionConfig === 'both');
    const doComment = (xActionConfig === 'comment' || xActionConfig === 'both');

    if (doComment && !doDM) {
      try {
        await sendNativeTwitterComment(activeTwitter.value, activeTwitter.ct0, bareTweetId, message);
        return { status: 'sent', action: 'comment', message };
      } catch (nativeErr) {
        console.log('Native Twitter comment fallback to CLI script:', nativeErr.message);
      }
    }

    const pyCode = `
import sys, json
from twitter_cli.client import TwitterClient
client = TwitterClient(auth_token="${activeTwitter.value}", ct0="${activeTwitter.ct0 || ''}")
results = {}
if ${doDM ? 'True' : 'False'}:
    try:
        user = client.fetch_user("${screenName}")
        url = "https://x.com/i/api/1.1/direct_messages/events/new.json"
        payload = {
            "event": {
                "type": "message_create",
                "message_create": {
                    "target": {"recipient_id": user.id},
                    "message_data": {"text": ${JSON.stringify(message)}}
                }
            }
        }
        client._api_request(url, method="POST", body=payload)
        results["dm"] = "sent"
    except Exception as e:
        results["dm_error"] = str(e)

if ${doComment ? 'True' : 'False'}:
    try:
        client.create_tweet(${JSON.stringify(message)}, reply_to_id="${bareTweetId}")
        results["comment"] = "sent"
    except Exception as e:
        results["comment_error"] = str(e)

print(json.dumps(results))
`;
    const pythonPath = isWin ? path.join(home, '.agent-reach-venv', 'Scripts', 'python.exe') : 'python3';
    const { stdout, error, stderr } = await runCli(pythonPath, ['-c', pyCode], { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
    if (error) throw new Error(stderr || error.message);
    const resp = JSON.parse(stdout || '{}');
    if (doDM && resp.dm_error) throw new Error('DM Error: ' + resp.dm_error);
    if (doComment && resp.comment_error) throw new Error('Comment Error: ' + resp.comment_error);
    return { status: 'sent', action: xActionConfig, message };
  }
};

// --- Automated 24/7 Search & Auto-Outreach Engine ---
let bgIntervalId = null;

const runBackgroundSearch = async () => {
  const cfg = getConfig();
  if (!cfg.keywords || cfg.keywords.length === 0) return;

  console.log(`[24/7 Engine] Auto-searching keywords: ${cfg.keywords.join(', ')}...`);
  const data = getTokensData();
  const activeTwitter = data.tokens.find(t => t.id === data.activeTwitterTokenId);
  const activeReddit = data.tokens.find(t => t.id === data.activeRedditTokenId);

  try {
    const hoursNum = 24;
    const [redditResults, twitterResults] = await Promise.all([
      (async () => {
        const results = [];
        for (const kw of cfg.keywords) {
          const kwRes = await scrapeRedditNative(kw);
          results.push(...kwRes);
        }
        return results;
      })(),
      scrapeTwitterCli(cfg.keywords, hoursNum, activeTwitter?.value, activeTwitter?.ct0, cfg.excludes)
    ]);

    let allResults = [...twitterResults, ...redditResults];
    if (cfg.excludes?.length > 0) {
      allResults = allResults.filter(item => {
        const lowerText = item.text.toLowerCase();
        return !cfg.excludes.some(ex => lowerText.includes(ex));
      });
    }

    const seenAuthorsBg = new Set();
    allResults = allResults.filter(item => {
      const handle = item.userProfile?.handle?.toLowerCase();
      if (!handle) return true;
      if (seenAuthorsBg.has(handle)) return false;
      seenAuthorsBg.add(handle);
      return true;
    });

    const discovered = getDiscoveredPosts();
    const existingIds = new Set(discovered.map(p => p.id));
    const sentLogs = getSentLogs();
    const sentPostIds = new Set(sentLogs.map(l => l.postId));
    
    let newCount = 0;
    const newlyDiscovered = [];

    allResults.forEach(post => {
      if (!existingIds.has(post.id)) {
        const fullPost = { ...post, isRead: false, notified: false };
        discovered.push(fullPost);
        newlyDiscovered.push(fullPost);
        newCount++;
      }
    });

    if (newCount > 0) {
      discovered.sort((a, b) => new Date(b.time) - new Date(a.time));
      saveDiscoveredPosts(discovered);
      console.log(`[24/7 Engine] Found ${newCount} new leads.`);
    }

    // Auto Outreach Execution (Processes both newly discovered and existing unsent leads)
    if (cfg.autoOutreachEnabled) {
      const unsentLeads = discovered.filter(p => !sentPostIds.has(p.id));
      if (unsentLeads.length > 0) {
        console.log(`[24/7 Engine] Found ${unsentLeads.length} unsent leads. Starting auto-outreach...`);
        for (const post of unsentLeads.slice(0, 10)) {
          if (sentPostIds.has(post.id)) continue;
          try {
            console.log(`[24/7 Engine] Auto-Outreaching to ${post.userProfile.handle} (${post.platform})...`);
            const res = await executeActionForPost(post, cfg.xActionConfig);
            const logEntry = {
              id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
              postId: post.id,
              platform: post.platform,
              userProfile: post.userProfile,
              action: res.action,
              message: res.message,
              timestamp: new Date().toISOString(),
              status: 'success'
            };
            sentLogs.push(logEntry);
            sentPostIds.add(post.id);
            saveSentLogs(sentLogs);
            console.log(`[24/7 Engine] Successfully sent auto-outreach to ${post.userProfile.handle}`);
            
            // Telegram Push Notification
            sendTelegramMessage(`🚀 <b>Auto-Comment Posted!</b>\n\n👤 <b>Target:</b> ${post.userProfile?.name} (${post.userProfile?.handle})\n🌐 <b>Platform:</b> ${post.platform.toUpperCase()}\n💬 <b>Comment Text:</b> "${res.message}"\n🔗 <a href="${post.postUrl}">View Original Post</a>`);

            // Anti-spam delay: wait 30s before next auto-send
            await new Promise(r => setTimeout(r, 30000));
          } catch (err) {
            console.error(`[24/7 Engine] Auto-Outreach failed for ${post.userProfile?.handle}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error("[24/7 Engine] Search error:", err.message);
  }
};

const startBackgroundWorker = () => {
  if (bgIntervalId) clearInterval(bgIntervalId);
  const cfg = getConfig();
  const intervalMs = (cfg.intervalMinutes || 5) * 60 * 1000;
  runBackgroundSearch();
  bgIntervalId = setInterval(runBackgroundSearch, intervalMs);
};

setTimeout(startBackgroundWorker, 5000);

// --- REST APIs for Mobile & App Interface ---
app.get('/api/health', (req, res) => res.json({ status: 'ok', activeProfile, uptime: process.uptime() }));
app.get('/api/profiles', (req, res) => {
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
  const dirs = fs.readdirSync(PROFILES_DIR).filter(file => fs.statSync(path.join(PROFILES_DIR, file)).isDirectory());
  if (!dirs.includes('default')) dirs.push('default');
  res.json({ activeProfile, profiles: dirs });
});

app.post('/api/profiles', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const cleanName = name.replace(/[^a-zA-Z0-9_\-]/g, '').trim();
  activeProfile = cleanName;
  saveActiveProfile(cleanName);
  const newDir = path.join(PROFILES_DIR, cleanName);
  if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
  startBackgroundWorker();
  const dirs = fs.readdirSync(PROFILES_DIR).filter(file => fs.statSync(path.join(PROFILES_DIR, file)).isDirectory());
  if (!dirs.includes('default')) dirs.push('default');
  res.json({ activeProfile, profiles: dirs });
});

app.put('/api/profiles/active', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  activeProfile = name;
  saveActiveProfile(name);
  startBackgroundWorker();
  res.json({ activeProfile });
});

// --- Data Export & Import APIs ---
app.get('/api/debug-scrape', async (req, res) => {
  const cfg = getConfig();
  const keyword = cfg.keywords[0] || 'hiring video editor';
  const redditPosts = await scrapeRedditNative(keyword);
  res.json({
    keyword,
    redditNativeCount: redditPosts.length,
    redditSample: redditPosts.slice(0, 3)
  });
});

app.get('/api/debug-twitter', async (req, res) => {
  const data = getTokensData();
  const activeTwitter = data.tokens.find(t => t.id === data.activeTwitterTokenId);
  const args = ['search', 'video editor', '--type', 'latest', '--json'];
  const envs = { 
    PYTHONIOENCODING: 'utf-8', 
    PYTHONUTF8: '1', 
    TWITTER_AUTH_TOKEN: activeTwitter?.value || ''
  };
  if (activeTwitter?.ct0) envs.TWITTER_CT0 = activeTwitter.ct0;

  const run1 = await runCli('python3', ['-m', 'twitter_cli.cli', ...args], envs);
  const run2 = await runCli('twitter', args, envs);

  res.json({
    activeTwitterId: data.activeTwitterTokenId,
    tokenValueLength: activeTwitter?.value?.length || 0,
    ct0Length: activeTwitter?.ct0?.length || 0,
    pythonRun: {
      stdout: run1.stdout.substring(0, 1000),
      stderr: run1.stderr.substring(0, 1000),
      error: run1.error?.message
    },
    cliRun: {
      stdout: run2.stdout.substring(0, 1000),
      stderr: run2.stderr.substring(0, 1000),
      error: run2.error?.message
    }
  });
});

app.get('/api/debug-dir', (req, res) => {
  const pyPkgPath = path.join(__dirname, 'python_packages');
  if (!fs.existsSync(pyPkgPath)) {
    return res.json({ error: 'python_packages does not exist' });
  }
  const files = fs.readdirSync(pyPkgPath);
  res.json({ files });
});

app.get('/api/export-data', (req, res) => {
  const exportBundle = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    activeProfile,
    config: getConfig(),
    tokens: getTokensData(),
    templates: getTemplatesData(),
    discoveredPosts: getDiscoveredPosts()
  };
  res.json(exportBundle);
});

app.post('/api/import-data', (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'No data provided' });

    if (data.config) saveConfig(data.config);
    if (data.tokens) saveTokensData(data.tokens);
    if (data.templates) saveTemplatesData(data.templates);
    if (data.discoveredPosts) saveDiscoveredPosts(data.discoveredPosts);

    startBackgroundWorker();
    res.json({ success: true, message: 'Data imported successfully!' });
  } catch (err) {
    console.error('Import Error:', err);
    res.status(500).json({ error: 'Failed to import data: ' + err.message });
  }
});

app.get('/api/tokens', (req, res) => res.json(getTokensData()));
app.post('/api/tokens', (req, res) => {
  const { label, value, type, ct0 } = req.body;
  if (!value) return res.status(400).json({ error: 'Token value is required' });
  const data = getTokensData();
  const newToken = { id: Date.now().toString(), type: type || 'twitter', label: label || 'Token', value, ct0: ct0 || '' };
  data.tokens.push(newToken);
  if (type === 'reddit') {
    data.activeRedditTokenId = newToken.id;
  } else {
    data.activeTwitterTokenId = newToken.id;
  }
  saveTokensData(data);
  res.json(data);
});
app.put('/api/tokens/active', (req, res) => {
  const { id, type } = req.body;
  const data = getTokensData();
  if (type === 'reddit') data.activeRedditTokenId = id;
  else data.activeTwitterTokenId = id;
  saveTokensData(data);
  res.json(data);
});
app.delete('/api/tokens/:id', (req, res) => {
  const data = getTokensData();
  data.tokens = data.tokens.filter(t => t.id !== req.params.id);
  saveTokensData(data);
  res.json(data);
});

app.get('/api/templates', (req, res) => res.json(getTemplatesData()));
app.post('/api/templates', (req, res) => {
  const { text, keyword } = req.body;
  if (!text) return res.status(400).json({ error: 'Template text is required' });
  const data = getTemplatesData();
  data.templates.push({ id: Date.now().toString(), text, keyword: keyword?.trim() || undefined });
  saveTemplatesData(data);
  res.json(data);
});
app.delete('/api/templates/:id', (req, res) => {
  const data = getTemplatesData();
  data.templates = data.templates.filter(t => t.id !== req.params.id);
  saveTemplatesData(data);
  res.json(data);
});

app.get('/api/config', (req, res) => res.json(getConfig()));
app.post('/api/config', (req, res) => {
  const { keywords, excludes, intervalMinutes, autoOutreachEnabled, xActionConfig } = req.body;
  const cfg = getConfig();
  if (keywords) cfg.keywords = keywords;
  if (excludes) cfg.excludes = excludes;
  if (intervalMinutes) cfg.intervalMinutes = parseInt(intervalMinutes) || 5;
  if (autoOutreachEnabled !== undefined) cfg.autoOutreachEnabled = autoOutreachEnabled;
  if (xActionConfig) cfg.xActionConfig = xActionConfig;
  saveConfig(cfg);
  startBackgroundWorker();
  res.json(cfg);
});

app.get('/api/inbox-posts', async (req, res) => {
  const { refresh } = req.query;
  if (refresh === 'true') await runBackgroundSearch();
  const posts = getDiscoveredPosts();
  const seenAuthors = new Set();
  const uniquePosts = posts.filter(item => {
    const handle = item.userProfile?.handle?.toLowerCase();
    if (!handle) return true;
    if (seenAuthors.has(handle)) return false;
    seenAuthors.add(handle);
    return true;
  });
  res.json({ posts: uniquePosts });
});

app.get('/api/sent-logs', (req, res) => res.json({ logs: getSentLogs() }));

app.post('/api/manual-search', async (req, res) => {
  try {
    const { keywords, platform, hours, excludes } = req.body;
    const rawKeywords = Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(s => s.trim()) : []);
    if (rawKeywords.length === 0) return res.status(400).json({ error: 'Keywords are required' });

    const hoursNum = parseInt(hours) || 24;
    const excludeList = Array.isArray(excludes) ? excludes : (excludes ? excludes.split(',').map(s => s.trim()) : []);
    const data = getTokensData();
    const activeTwitter = data.tokens.find(t => t.id === data.activeTwitterTokenId);
    const activeReddit = data.tokens.find(t => t.id === data.activeRedditTokenId);

    let redditResults = [];
    let twitterResults = [];

    if (!platform || platform === 'all' || platform === 'reddit') {
      for (const kw of rawKeywords) {
        const kwRes = await scrapeRedditNative(kw);
        redditResults.push(...kwRes);
      }
    }
    if (!platform || platform === 'all' || platform === 'twitter') {
      twitterResults = await scrapeTwitterCli(rawKeywords, hoursNum, activeTwitter?.value, activeTwitter?.ct0, excludeList);
    }

    let allResults = [...twitterResults, ...redditResults];
    if (excludeList.length > 0) {
      allResults = allResults.filter(item => {
        const lowerText = item.text.toLowerCase();
        return !excludeList.some(ex => lowerText.includes(ex.toLowerCase()));
      });
    }

    res.json({ posts: allResults });
  } catch (err) {
    console.error('Manual Search Error:', err);
    res.status(500).json({ error: 'Failed to perform manual search: ' + err.message });
  }
});

app.post('/api/send-single-post', async (req, res) => {
  try {
    const { post, message, action } = req.body;
    if (!post || !post.id) return res.status(400).json({ error: 'Post object required' });

    let sentMessage = message;
    if (!sentMessage || !sentMessage.trim()) {
      const templatesData = getTemplatesData();
      if (templatesData.templates.length === 0) throw new Error('No DM templates available.');
      const templateObj = templatesData.templates[Math.floor(Math.random() * templatesData.templates.length)];
      sentMessage = templateObj.text;
    }

    const data = getTokensData();
    const activeTwitter = data.tokens.find(t => t.id === data.activeTwitterTokenId);
    const activeReddit = data.tokens.find(t => t.id === data.activeRedditTokenId);

    const isReddit = post.platform === 'reddit' || post.id.startsWith('reddit_');
    const xActionConfig = action || 'comment';

    if (isReddit) {
      if (!activeReddit || !activeReddit.value) throw new Error('No active Reddit token');
      const pyCode = `
import sys, json
from rdt_cli.client import RedditClient
client = RedditClient(session_cookie="${activeReddit.value}")
try:
    client.send_message("${post.userProfile?.handle?.replace('u/', '')}", ${JSON.stringify(sentMessage)})
    print(json.dumps({"status": "sent"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
      const pythonPath = isWin ? path.join(home, '.agent-reach-venv', 'Scripts', 'python.exe') : 'python3';
      const { stdout, error, stderr } = await runCli(pythonPath, ['-c', pyCode], { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
      if (error) throw new Error(stderr || error.message);
      const resp = JSON.parse(stdout || '{}');
      if (resp.error) throw new Error(resp.error);
    } else {
      if (!activeTwitter || !activeTwitter.value) throw new Error('No active Twitter token');
      const bareTweetId = post.id.replace('twitter_', '');
      await sendNativeTwitterComment(activeTwitter.value, activeTwitter.ct0, bareTweetId, sentMessage);
    }

    const sentLogs = getSentLogs();
    const logEntry = {
      id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
      postId: post.id,
      platform: post.platform,
      userProfile: post.userProfile,
      action: xActionConfig,
      message: sentMessage,
      timestamp: new Date().toISOString(),
      status: 'success'
    };
    sentLogs.push(logEntry);
    saveSentLogs(sentLogs);

    sendTelegramMessage(`🚀 <b>Manual Post Outreach Sent!</b>\n\n👤 <b>Target:</b> ${post.userProfile?.name} (${post.userProfile?.handle})\n🌐 <b>Platform:</b> ${post.platform.toUpperCase()}\n💬 <b>Text:</b> "${sentMessage}"\n🔗 <a href="${post.postUrl}">View Post</a>`);

    res.json({ success: true, action: xActionConfig, message: sentMessage });
  } catch (err) {
    console.error('Send Single Post Error:', err);
    res.status(500).json({ error: 'Failed to send outreach: ' + err.message });
  }
});

app.post('/api/send-dms', async (req, res) => {
  const { posts, xAction } = req.body;
  if (!Array.isArray(posts) || posts.length === 0) return res.status(400).json({ error: 'Posts array required' });
  const results = [];
  const sentLogs = getSentLogs();
  
  for (const post of posts) {
    try {
      const resData = await executeActionForPost(post, xAction || 'both');
      results.push({ id: post.id, status: 'sent', action: resData.action });
      sentLogs.push({
        id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        postId: post.id,
        platform: post.platform,
        userProfile: post.userProfile,
        action: resData.action,
        message: resData.message,
        timestamp: new Date().toISOString(),
        status: 'success'
      });
    } catch (err) {
      results.push({ id: post.id, status: 'failed', error: err.message });
    }
  }
  saveSentLogs(sentLogs);
  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`[Cloud Engine] Server listening on port ${PORT}`);
});
