const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('os').platform() === 'win32' ? require('path').win32 : require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

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
    path.join(__dirname, '..', 'backend'),
    'C:\\Users\\navee\\Downloads\\x & reddit\\backend',
    __dirname
  ];

  files.forEach(f => {
    const dest = path.join(defaultDir, f);
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
    const options = {
      env: { ...process.env, ...envVars },
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
    if (!cfg.xActionConfig) cfg.xActionConfig = 'both';
    return cfg;
  } catch (e) {
    return { 
      keywords: ['hiring video editor', 'need video editor', 'looking for editor', 'need thumbnail', 'looking for thumbnail', 'hiring thumbnail'], 
      excludes: ['?'], 
      intervalMinutes: 5,
      autoOutreachEnabled: true,
      xActionConfig: 'both'
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
      const { stdout, error } = await runCli(TWITTER_PATH, args, envs);
      if (error || !stdout) continue;
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

const scrapeRedditCli = async (keywords, hours, tokenValue) => {
  if (!keywords || keywords.length === 0) return [];
  const allPostsMap = new Map();
  const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

  for (const keyword of keywords) {
    const args = ['search', keyword, '--type', 'new', '--json'];
    const envs = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    if (tokenValue) envs.REDDIT_SESSION = tokenValue;

    try {
      const { stdout, error } = await runCli(REDDIT_PATH, args, envs);
      if (error || !stdout) continue;
      let listing = JSON.parse(stdout);
      let posts = Array.isArray(listing) ? listing : (listing?.items || listing?.data || []);

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
    } catch (err) {}
  }
  return Array.from(allPostsMap.values());
};

// --- Execution Dispatch Helper ---
const executeActionForPost = async (post, xActionConfig = 'both') => {
  const templatesData = getTemplatesData();
  if (templatesData.templates.length === 0) {
    throw new Error('No DM templates configured.');
  }

  const postTextLower = (post.text || '').toLowerCase();
  const matchingTemplates = templatesData.templates.filter(t => 
    t.keyword && postTextLower.includes(t.keyword.trim().toLowerCase())
  );
  
  let templateObj;
  if (matchingTemplates.length > 0) {
    templateObj = matchingTemplates[Math.floor(Math.random() * matchingTemplates.length)];
  } else {
    const fallbacks = templatesData.templates.filter(t => !t.keyword);
    const pool = fallbacks.length > 0 ? fallbacks : templatesData.templates;
    templateObj = pool[Math.floor(Math.random() * pool.length)];
  }

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
      scrapeRedditCli(cfg.keywords, hoursNum, activeReddit?.value),
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

    // Auto Outreach Execution
    if (cfg.autoOutreachEnabled) {
      for (const post of newlyDiscovered) {
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
          
          // Anti-spam delay: wait 30s before next auto-send
          await new Promise(r => setTimeout(r, 30000));
        } catch (err) {
          console.error(`[24/7 Engine] Auto-Outreach failed for ${post.userProfile?.handle}:`, err.message);
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
  if (type === 'reddit') { if (!data.activeRedditTokenId) data.activeRedditTokenId = newToken.id; }
  else { if (!data.activeTwitterTokenId) data.activeTwitterTokenId = newToken.id; }
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
