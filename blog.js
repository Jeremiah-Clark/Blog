// blog.js — loads markdown posts from a GitHub folder with permalinks, truncation, pagination, and tag filtering
(function () {
  var GH_USER   = "Jeremiah-Clark";
  var GH_REPO   = "Blog";
  var GH_BRANCH = "main";
  var POSTS_DIR = "blog";
  var POSTS_PER_PAGE = 10;
  var EXCERPT_BLOCKS = 3; // number of content blocks to show in list view

  // Base URL where relative image/asset paths are resolved against.
  // Posts live in /blog, so a path like ../images/foo.png from a post
  // resolves to https://.../Blog@main/images/foo.png
  var ASSET_BASE = "https://raw.githubusercontent.com/" + GH_USER + "/" + GH_REPO + "/" + GH_BRANCH + "/" + POSTS_DIR + "/";

  var statusEl    = document.getElementById("blog-status");
  var containerEl = document.getElementById("blog-container");

  if (!statusEl || !containerEl) {
    console.error("[blog] missing #blog-status or #blog-container in DOM");
    return;
  }

  var postsBySlug = {};
  var postsArray = []; // sorted array of all posts
  var allTags = [];    // [{ slug, label }], unique across all posts, sorted by slug
  var originalTitle = document.title;

  // ---------- utilities ----------

  function showError(msg) {
    console.error("[blog]", msg);
    statusEl.style.display = "block";
    statusEl.style.color = "#b00";
    statusEl.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function slugify(s) {
    return String(s).toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
  }

  function formatDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined,
      { year: "numeric", month: "long", day: "numeric" });
  }

  function makePermalink(slug) {
    return "?post=" + encodeURIComponent(slug) + "#blog";
  }

  function makeTagLink(tagSlug) {
    return "?tag=" + encodeURIComponent(tagSlug) + "&page=1#blog";
  }

  // Resolve a relative URL against the post's base location in the repo.
  // Absolute URLs (http://, https://, //, data:) are passed through unchanged.
  // Anchor links (#foo) and absolute repo paths (/foo) are also passed through.
  function resolveAssetUrl(url) {
    if (!url) return url;
    if (/^([a-z]+:)?\/\//i.test(url)) return url; // http://, https://, //
    if (/^(data|mailto|tel):/i.test(url)) return url;
    if (url.charAt(0) === '#') return url;
    if (url.charAt(0) === '/') return url;
    try {
      return new URL(url, ASSET_BASE).href;
    } catch (e) {
      return url;
    }
  }

  // ---------- markdown rendering ----------

  function renderInline(text) {
    // 1. Extract inline code into placeholders so subsequent regexes can't touch their contents.
    var codeChunks = [];
    text = text.replace(/`([^`]+)`/g, function (_, code) {
      var placeholder = '\x00code' + codeChunks.length + '\x00';
      codeChunks.push('<code>' + escapeHtml(code) + '</code>');
      return placeholder;
    });
    // 2. Bold and italic before links, so they only ever wrap plain text.
    text = text.replace(/\*\*([^*]+)\*\*/g, function(_, s) {
      return '<strong>' + escapeHtml(s) + '</strong>';
    });
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, function(_, pre, s) {
      return pre + '<em>' + escapeHtml(s) + '</em>';
    });
    // 3. Images before links (more specific pattern first).
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
      return '<img src="' + escapeHtml(resolveAssetUrl(url)) + '" alt="' + escapeHtml(alt) + '" loading="lazy">';
    });
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, url) {
      return '<a href="' + escapeHtml(resolveAssetUrl(url)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(t) + '</a>';
    });
    // 4. Escape remaining plain text segments (between HTML tags and placeholders).
    text = text.replace(/(?:^|(?<=>))([^<\x00]*)(?=<|\x00|$)/g, function(_, plain) {
      return escapeHtml(plain);
    });
    // 5. Restore code placeholders.
    text = text.replace(/\x00code(\d+)\x00/g, function(_, i) {
      return codeChunks[+i];
    });
    return text;
  }

  // Strip the common leading whitespace from a block of lines.
  // Empty lines are ignored when calculating the minimum indent.
  function dedent(lines) {
    var minIndent = Infinity;
    lines.forEach(function (line) {
      if (line.trim().length > 0) {
        var indent = line.match(/^(\s*)/)[1].length;
        if (indent < minIndent) minIndent = indent;
      }
    });
    if (!isFinite(minIndent)) minIndent = 0;
    return lines.map(function (line) { return line.slice(minIndent); });
  }

  function mdToHtml(md) {
    var lines = md.replace(/\r\n/g, "\n").split("\n");
    var out = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      // Raw HTML passthrough: lines starting with < are output as-is
      if (/^<[a-zA-Z\/]/.test(line)) {
        out.push(line);
        i++;
        continue;
      }
      // Code fence: allow optional leading whitespace before the backticks
      if (/^\s*```/.test(line)) {
        var code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + escapeHtml(dedent(code).join("\n")) + '</code></pre>');
        continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        out.push('<h' + h[1].length + '>' + renderInline(h[2]) + '</h' + h[1].length + '>');
        i++; continue;
      }
      if (/^>\s?/.test(line)) {
        var bq = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          bq.push(lines[i].replace(/^>\s?/, "")); i++;
        }
        var admonitionIcons = { note: 'ℹ', tip: '✦', warning: '⚠', important: '◆', caution: '✖' };
        var admonitionMatch = bq[0] && bq[0].trim().match(/^\[!(note|tip|warning|important|caution)\]/i);
        if (admonitionMatch) {
          var adType = admonitionMatch[1].toLowerCase();
          var adBody = bq.slice(1).join(" ").trim();
          var adLabel = adType.charAt(0).toUpperCase() + adType.slice(1);
          out.push(
            '<div class="admonition admonition-' + adType + '">' +
              '<div class="admonition-title">' + admonitionIcons[adType] + ' ' + adLabel + '</div>' +
              (adBody ? '<p class="admonition-body">' + renderInline(adBody) + '</p>' : '') +
            '</div>'
          );
        } else {
          out.push('<blockquote>' + mdToHtml(bq.join("\n")) + '</blockquote>');
        }
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++;
        }
        out.push('<ul>' + items.map(function (x) {
          return '<li>' + renderInline(x) + '</li>';
        }).join("") + '</ul>');
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        var oitems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          oitems.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++;
        }
        out.push('<ol>' + oitems.map(function (x) {
          return '<li>' + renderInline(x) + '</li>';
        }).join("") + '</ol>');
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      var para = [];
      while (i < lines.length &&
             !/^\s*$/.test(lines[i]) &&
             !/^#{1,6}\s+/.test(lines[i]) &&
             !/^\s*```/.test(lines[i]) &&
             !/^>\s?/.test(lines[i]) &&
             !/^\s*[-*+]\s+/.test(lines[i]) &&
             !/^\s*\d+\.\s+/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push('<p>' + renderInline(para.join(" ")) + '</p>');
    }
    return out.join("\n");
  }

  // ---------- post parsing ----------

  // Parses a "tags" field out of a raw frontmatter block. Supports three
  // explicit forms only — no hashtag scanning of the article body:
  //   tags: foo, bar, baz
  //   tags: [foo, bar, baz]
  //   tags:
  //     - foo
  //     - bar
  function parseTagsFromFrontmatter(fmText) {
    function cleanItem(s) {
      return s.trim().replace(/^["']|["']$/g, "");
    }

    // Inline bracketed list: tags: [foo, bar]
    var inlineList = fmText.match(/^tags:\s*\[(.*)\]\s*$/m);
    if (inlineList) {
      return inlineList[1].split(",").map(cleanItem).filter(Boolean);
    }

    // Multi-line YAML list (Obsidian's default "tags" property format):
    //   tags:
    //     - foo
    //     - bar
    var blockList = fmText.match(/^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
    if (blockList) {
      return blockList[1].split("\n").map(function (line) {
        var m = line.match(/^\s*-\s*(.+)$/);
        return m ? cleanItem(m[1]) : null;
      }).filter(Boolean);
    }

    // Single-line comma-separated: tags: foo, bar, baz
    var singleLine = fmText.match(/^tags:\s*(.+)$/m);
    if (singleLine) {
      return singleLine[1].split(",").map(cleanItem).filter(Boolean);
    }

    return [];
  }

  function parsePost(filename, text) {
    var title = filename.replace(/\.md$/i, "");
    var date  = "";
    var slug  = "";
    var tags  = [];
    var body  = text;

    var fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (fm) {
      body = fm[2];
      var frontmatterText = fm[1];
      var t = frontmatterText.match(/^title:\s*(.+)$/m);
      var d = frontmatterText.match(/^date:\s*(.+)$/m);
      var s = frontmatterText.match(/^slug:\s*(.+)$/m);
      if (t) title = t[1].trim().replace(/^["']|["']$/g, "");
      if (d) date  = d[1].trim().replace(/^["']|["']$/g, "");
      if (s) slug  = s[1].trim().replace(/^["']|["']$/g, "");
      tags = parseTagsFromFrontmatter(frontmatterText);
    } else {
      var h1 = body.match(/^#\s+(.+)$/m);
      if (h1) { title = h1[1].trim(); body = body.replace(/^#\s+.+\n?/, ""); }
    }
    if (!date) {
      var m = filename.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
      if (m) date = m[1] + "-" + m[2] + "-" + m[3];
    }
    if (!slug) {
      var base = filename.replace(/\.md$/i, "").replace(/^\d{4}-?\d{2}-?\d{2}\s*/, "");
      slug = slugify(base);
    } else {
      slug = slugify(slug);
    }
    return { title: title, date: date, slug: slug, tags: tags, body: body };
  }

  // ---------- excerpt truncation ----------

  function truncateHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var children = Array.prototype.slice.call(tmp.children);
    if (children.length === 0) return { excerpt: html, truncated: false };

    var countedTags = { P:1, UL:1, OL:1, BLOCKQUOTE:1, PRE:1 };
    var blockCount = 0;
    var cutoff = children.length;

    for (var i = 0; i < children.length; i++) {
      if (countedTags[children[i].tagName]) blockCount++;
      if (blockCount >= EXCERPT_BLOCKS) {
        cutoff = i + 1;
        break;
      }
    }
    if (cutoff >= children.length) {
      return { excerpt: html, truncated: false };
    }
    var out = document.createElement('div');
    for (var j = 0; j < cutoff; j++) {
      out.appendChild(children[j].cloneNode(true));
    }
    return { excerpt: out.innerHTML, truncated: true };
  }

  // ---------- DOM assembly ----------

  function makeTagPillsHtml(tags) {
    if (!tags || !tags.length) return '';
    return '<p class="blog-tags" style="margin:0.3rem 0 0.8rem;">' +
      tags.map(function (t) {
        var tagSlug = slugify(t);
        return '<a href="' + makeTagLink(tagSlug) + '" data-blog-tag class="blog-tag-pill" ' +
          'style="display:inline-block;padding:0.2rem 0.6rem;margin:0 0.35rem 0.35rem 0;' +
          'background:#F4F4F5;border:1px solid #ddd;border-radius:12px;color:#B02F68;' +
          'text-decoration:none;font-size:0.8rem;">' + escapeHtml(t) + '</a>';
      }).join('') +
      '</p>';
  }

  function renderPost(parsed) {
    var fullHtml = mdToHtml(parsed.body);
    var truncation = truncateHtml(fullHtml);
    var permalink = makePermalink(parsed.slug);

    var el = document.createElement("article");
    el.className = "blog-post";
    el.setAttribute("data-slug", parsed.slug);
    el.innerHTML =
      '<h2 class="blog-title">' +
        '<a href="' + permalink + '" data-permalink class="blog-title-link">' +
          escapeHtml(parsed.title) +
        '</a>' +
      '</h2>' +
      (parsed.date ? '<p class="blog-date">' + escapeHtml(formatDate(parsed.date)) + '</p>' : '') +
      makeTagPillsHtml(parsed.tags) +
      '<div class="blog-body">' + fullHtml + '</div>' +
      '<div class="blog-excerpt">' + truncation.excerpt +
        (truncation.truncated
          ? '<p class="blog-readmore-wrap">' +
              '<a href="' + permalink + '" data-permalink class="blog-readmore">Read more →</a>' +
            '</p>'
          : '') +
      '</div>';
    return el;
  }

  function makeBackLink() {
    var a = document.createElement('a');
    a.className = 'blog-back';
    a.href = '?page=1#blog';
    a.setAttribute('data-blog-back', '');
    a.textContent = '← All posts';
    return a;
  }

  function makeTagFilterBar(activeTagSlug) {
    if (!allTags.length) return '';
    var html = '<nav id="blog-tag-filter" style="display:flex;flex-wrap:wrap;align-items:center;' +
      'gap:0.5rem;margin:1rem 0;padding:0.75rem 0;border-bottom:1px solid #e0e0e0;">';
    html += '<span style="font-size:0.85rem;color:#666;margin-right:0.2rem;">Filter by tag:</span>';

    function pillStyle(active) {
      return 'display:inline-block;padding:0.25rem 0.75rem;border-radius:12px;font-size:0.85rem;' +
        'text-decoration:none;' +
        (active ? 'background:#B02F68;color:#fff;' : 'background:#F4F4F5;border:1px solid #ddd;color:#B02F68;');
    }

    html += '<a href="?page=1#blog" style="' + pillStyle(!activeTagSlug) + '">All</a>';
    allTags.forEach(function (t) {
      html += '<a href="' + makeTagLink(t.slug) + '" style="' + pillStyle(t.slug === activeTagSlug) + '">' +
        escapeHtml(t.label) + '</a>';
    });
    html += '</nav>';
    return html;
  }

  function makePaginationNav(currentPage, totalPages, tagSlug) {
    var tagQS = tagSlug ? 'tag=' + encodeURIComponent(tagSlug) + '&' : '';
    var html = '<nav id="blog-pagination-nav" style="display: flex; align-items: center; justify-content: center; gap: 0; margin: 2rem 0; padding: 1rem; border-top: 1px solid #e0e0e0;">';

    if (currentPage > 1) {
      html += '<a href="?' + tagQS + 'page=' + (currentPage - 1) + '#blog" style="display: inline-block; padding: 0.5rem 1rem; background: #F4F4F5; border: 1px solid #ddd; border-radius: 4px; color: #B02F68; text-decoration: none; font-size: 0.95rem; transition: all 0.2s ease; margin-right: 1em;">← Previous</a>';
    }

    html += '<span style="font-size: 0.9rem; color: #666; white-space: nowrap; margin: 0 1em;">Page ' + currentPage + ' of ' + totalPages + '</span>';

    if (currentPage < totalPages) {
      html += '<a href="?' + tagQS + 'page=' + (currentPage + 1) + '#blog" style="display: inline-block; padding: 0.5rem 1rem; background: #F4F4F5; border: 1px solid #ddd; border-radius: 4px; color: #B02F68; text-decoration: none; font-size: 0.95rem; transition: all 0.2s ease; margin-left: 1em;">Next →</a>';
    }

    html += '</nav>';
    return html;
  }

  // ---------- view state management ----------

  function updateView() {
    var params = new URLSearchParams(location.search);
    var postSlug = params.get('post');
    var pageNum = parseInt(params.get('page'), 10) || 1;
    var tagParam = params.get('tag') ? slugify(params.get('tag')) : null;

    // ALWAYS remove pagination, tag filter bar, and empty-state message first,
    // we'll re-add whichever are needed below.
    var existingNav = containerEl.querySelector('#blog-pagination-nav');
    if (existingNav) existingNav.remove();
    var existingTagBar = containerEl.querySelector('#blog-tag-filter');
    if (existingTagBar) existingTagBar.remove();
    var existingEmpty = containerEl.querySelector('#blog-empty-message');
    if (existingEmpty) existingEmpty.remove();

    // Single post view takes priority
    if (postSlug && postsBySlug[postSlug]) {
      containerEl.classList.remove('mode-list');
      containerEl.classList.add('mode-single');
      var posts = containerEl.querySelectorAll('.blog-post');
      for (var i = 0; i < posts.length; i++) {
        if (posts[i].getAttribute('data-slug') === postSlug) {
          posts[i].classList.add('this-post');
          posts[i].style.display = 'block';
        } else {
          posts[i].classList.remove('this-post');
          posts[i].style.display = 'none';
        }
      }
      document.title = postsBySlug[postSlug].title + ' — ' + originalTitle;
      return;
    }

    // List view with pagination
    if (postSlug) {
      console.warn('[blog] unknown slug:', postSlug);
      history.replaceState(null, '', location.pathname + '?page=1#blog');
      pageNum = 1;
    }

    containerEl.classList.remove('mode-single');
    containerEl.classList.add('mode-list');
    document.title = originalTitle;

    // Filter by tag (if any), then paginate the filtered set
    var activePosts = tagParam
      ? postsArray.filter(function (p) {
          return p.tags.some(function (t) { return slugify(t) === tagParam; });
        })
      : postsArray;

    var totalPages = Math.max(1, Math.ceil(activePosts.length / POSTS_PER_PAGE));
    if (pageNum < 1 || pageNum > totalPages) pageNum = 1;
    var startIdx = (pageNum - 1) * POSTS_PER_PAGE;
    var endIdx = startIdx + POSTS_PER_PAGE;
    var visibleSlugs = activePosts.slice(startIdx, endIdx).map(function (p) { return p.slug; });

    var allPosts = containerEl.querySelectorAll('.blog-post');
    for (var k = 0; k < allPosts.length; k++) {
      var slug = allPosts[k].getAttribute('data-slug');
      allPosts[k].classList.remove('this-post');
      if (visibleSlugs.indexOf(slug) !== -1) {
        allPosts[k].style.display = 'block';
      } else {
        allPosts[k].style.display = 'none';
      }
    }

    // Tag filter bar goes right after the back link
    var backLinkEl = containerEl.querySelector('.blog-back');
    var tagBarHtml = makeTagFilterBar(tagParam);
    if (backLinkEl && tagBarHtml) {
      backLinkEl.insertAdjacentHTML('afterend', tagBarHtml);
    }

    if (activePosts.length === 0) {
      containerEl.insertAdjacentHTML('beforeend',
        '<p id="blog-empty-message" style="padding:2rem 0;color:#666;">No posts found for this tag.</p>');
    } else if (totalPages > 1) {
      containerEl.insertAdjacentHTML('beforeend', makePaginationNav(pageNum, totalPages, tagParam));
    }
  }

  function scrollToCurrent() {
    var params = new URLSearchParams(location.search);
    var slug = params.get('post');
    var target = null;
    if (slug) {
      target = containerEl.querySelector('.blog-post[data-slug="' + slug + '"]');
    }
    if (!target) target = containerEl;
    if (target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function handleContainerClick(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

    var permalink = e.target.closest ? e.target.closest('a[data-permalink]') : null;
    if (permalink) {
      e.preventDefault();
      history.pushState(null, '', permalink.getAttribute('href'));
      updateView();
      scrollToCurrent();
      return;
    }

    // Covers both pagination links and tag links (tag links always include
    // "page=1" in their href, so they're routed through here too).
    var pagination = e.target.closest ? e.target.closest('a[href*="page="]') : null;
    if (pagination && !pagination.hasAttribute('data-blog-back')) {
      e.preventDefault();
      history.pushState(null, '', pagination.getAttribute('href'));
      updateView();
      scrollToCurrent();
      return;
    }

    var back = e.target.closest ? e.target.closest('a[data-blog-back]') : null;
    if (back) {
      e.preventDefault();
      history.pushState(null, '', location.pathname + '?page=1#blog');
      updateView();
      scrollToCurrent();
      return;
    }
  }

  // ---------- load posts and initialize ----------

  var apiUrl = "https://api.github.com/repos/" + GH_USER + "/" + GH_REPO +
               "/contents/" + POSTS_DIR + "?ref=" + GH_BRANCH;

  fetch(apiUrl).then(function (r) {
    if (!r.ok) throw new Error("GitHub API " + r.status);
    return r.json();
  }).then(function (files) {
    var mdFiles = files.filter(function (f) {
      return f.name.toLowerCase().endsWith(".md");
    }).sort(function (a, b) { return b.name.localeCompare(a.name); });

    if (mdFiles.length === 0) { statusEl.textContent = "No posts yet."; return; }

    return Promise.all(mdFiles.map(function (f) {
      return fetch(f.download_url).then(function (r) { return r.text(); })
        .then(function (text) { return { name: f.name, text: text }; });
    }));
  }).then(function (posts) {
    if (!posts) return;

    statusEl.style.display = "none";
    containerEl.appendChild(makeBackLink());

    var tagMap = {}; // slug -> first-seen display label

    posts.forEach(function (p) {
      try {
        var parsed = parsePost(p.name, p.text);
        if (!parsed.slug) parsed.slug = 'post-' + Math.random().toString(36).slice(2, 8);
        if (postsBySlug[parsed.slug]) {
          console.warn('[blog] duplicate slug:', parsed.slug, 'for', p.name);
        }
        postsBySlug[parsed.slug] = parsed;
        postsArray.push(parsed);
        containerEl.appendChild(renderPost(parsed));
        parsed.tags.forEach(function (t) {
          var s = slugify(t);
          if (s && !tagMap[s]) tagMap[s] = t;
        });
      } catch (e) {
        console.error("[blog] render failed for", p.name, e);
      }
    });

    allTags = Object.keys(tagMap).sort().map(function (s) {
      return { slug: s, label: tagMap[s] };
    });

    containerEl.addEventListener('click', handleContainerClick);
    window.addEventListener('popstate', updateView);

    updateView();
  }).catch(function (err) {
    showError("Couldn't load posts: " + err.message);
  });
})();
