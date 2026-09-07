/* eslint-disable */
/**
 * Offline preview shim.
 *
 * Replaces `fetch` with an in-memory API backed by window.__TRACKER_WORLD__ —
 * one shared world, not a snapshot per login. The approval chain is the whole
 * product, so the four moves (submit, verify, approve, return) work for real
 * here: they change the task, append to its history and drop a line in the
 * right person's bell, exactly as the server does. Mark a task done as its
 * owner, sign in as the manager and confirm it, then as the CEO and approve.
 *
 * The rules below are a deliberate mirror of two server files —
 * `src/access.js` and `src/services/workflow.js`. Where a number or a phrase
 * appears in both, the server is the original. Nothing is written to disk:
 * reloading the page puts the demo back to the seeded state.
 */
(function () {
  window.__TRACKER_STATIC_PREVIEW__ = true;

  var W = window.__TRACKER_WORLD__;
  var session = null; // the email currently signed in

  // ---------------------------------------------------------------- helpers
  var json = function (body, status) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  };

  var nowSql = function () {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  };

  // Kept in step with server/src/routes/notifications.js by hand — the preview
  // is a copy of the app's behaviour, not a copy of its code.
  var SNOOZE_PRESETS = [
    { key: '1h', label: 'in an hour' },
    { key: '3h', label: 'in three hours' },
    { key: 'tomorrow', label: 'tomorrow morning' },
    { key: '3d', label: 'in three days' },
    { key: 'nextweek', label: 'next Monday' },
  ];
  var snoozeUntil = function (preset) {
    var w = new Date();
    if (preset === '1h') w.setHours(w.getHours() + 1);
    else if (preset === '3h') w.setHours(w.getHours() + 3);
    else if (preset === '3d') {
      w.setDate(w.getDate() + 3);
      w.setHours(9, 0, 0, 0);
    } else if (preset === 'nextweek') {
      w.setDate(w.getDate() + (((8 - w.getDay()) % 7) || 7));
      w.setHours(9, 0, 0, 0);
    } else {
      w.setDate(w.getDate() + 1);
      w.setHours(9, 0, 0, 0);
    }
    return w.toISOString().slice(0, 19).replace('T', ' ');
  };
  var today = function () {
    var d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  };
  var contains = function (hay, needle) {
    return String(hay || '').toLowerCase().indexOf(needle) !== -1;
  };

  var nextId = 500000;
  var newId = function () {
    nextId += 1;
    return nextId;
  };

  // --------------------------------------------------- access.js, mirrored
  var can = function (user, permission) {
    var grants = W.permissions[user.role] || {};
    return Boolean(grants[permission]);
  };
  var ownOnly = function (user) {
    return !can(user, 'tasks.view_all');
  };
  var scopeLabel = function (user) {
    if (can(user, 'tasks.approve')) return 'Every task across the company';
    if (can(user, 'tasks.view_all')) return 'Every task — yours to assign and check';
    return 'The tasks assigned to you';
  };
  var inScope = function (user, t) {
    if (can(user, 'tasks.view_all')) return true;
    return t.ownerId === user.id || t.createdById === user.id;
  };
  var scoped = function (user) {
    return W.tasks.filter(function (t) {
      return inScope(user, t);
    });
  };

  // ------------------------------------------------- workflow.js, mirrored
  var OPEN_STATUSES = ['open', 'submitted', 'verified'];
  var isLive = function (t) {
    return OPEN_STATUSES.indexOf(t.status) !== -1;
  };
  var STATUS_LABEL = {
    open: 'Open',
    submitted: 'Submitted for completion',
    verified: 'Verified — awaiting approval',
    // (kept identical to server/src/services/workflow.js)
    approved: 'Approved',
    cancelled: 'Cancelled',
  };
  var WAITING_ON = {
    open: 'the owner',
    submitted: 'the manager to check',
    verified: 'the CEO to approve',
    approved: 'nobody — signed off',
    cancelled: 'nobody — cancelled',
  };

  var daysToDue = function (iso) {
    if (!iso) return null;
    var a = iso.split('-').map(Number);
    var b = today().split('-').map(Number);
    return Math.round(
      (Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000
    );
  };
  var overdueState = function (t) {
    var days = daysToDue(t.completionDate);
    if (!isLive(t) || days === null || days >= 0) return { overdue: false, days: days, lateSide: null };
    return {
      overdue: true,
      days: days,
      lateSide: t.status === 'open' ? 'owner' : t.status === 'submitted' ? 'verifier' : 'approver',
    };
  };
  /** Mirrors workflow.js: the CEO checks only what nobody else can check. */
  var hasOtherChecker = function (ownerId) {
    return W.users.some(function (u) {
      return u.isActive && u.role === 'admin' && u.id !== ownerId;
    });
  };
  var canCheck = function (t, user) {
    if (t.ownerId === user.id) return false;
    if (!can(user, 'tasks.verify')) return false;
    if (user.role === 'ceo') return !hasOtherChecker(t.ownerId);
    return true;
  };
  var hasOtherApprover = function (ownerId) {
    return W.users.some(function (u) {
      return u.isActive && u.role === 'ceo' && u.id !== ownerId;
    });
  };

  /** What this reader may do to this task right now. */
  var actionsFor = function (t, user) {
    var isOwner = t.ownerId === user.id;
    var live = isLive(t);
    return {
      canSubmit: live && isOwner && t.status === 'open',
      canVerify: t.status === 'submitted' && canCheck(t, user),
      canApprove: t.status === 'verified' && !isOwner && can(user, 'tasks.approve'),
      canReturn:
        (t.status === 'submitted' && canCheck(t, user)) ||
        (t.status === 'verified' && !isOwner && can(user, 'tasks.approve')),
      canEdit: live && can(user, 'tasks.edit'),
      canReassign: live && can(user, 'tasks.assign'),
      canCancel: live && can(user, 'tasks.cancel'),
      canReopen: t.status === 'approved' && can(user, 'tasks.reopen'),
      canAttach: live && (isOwner || can(user, 'tasks.edit')),
      canDeleteOthersAttachments: can(user, 'tasks.edit'),
    };
  };

  /** Everything derived, recomputed for this reader. */
  var shape = function (t, user) {
    var od = overdueState(t);
    var out = {};
    for (var k in t) out[k] = t[k];
    out.statusLabel = STATUS_LABEL[t.status];
    out.waitingOn = WAITING_ON[t.status];
    out.daysToDue = daysToDue(t.completionDate);
    out.isOverdue = od.overdue;
    out.lateSide = od.lateSide;
    out.mine = t.ownerId === user.id;
    var a = actionsFor(t, user);
    for (var p in a) out[p] = a[p];
    return out;
  };

  var findTask = function (id) {
    for (var i = 0; i < W.tasks.length; i++) {
      if (String(W.tasks[i].id) === String(id)) return W.tasks[i];
    }
    return null;
  };
  var findUser = function (id) {
    for (var i = 0; i < W.users.length; i++) {
      if (String(W.users[i].id) === String(id)) return W.users[i];
    }
    return null;
  };

  var record = function (taskId, actor, action, from, to, note) {
    if (!W.history[taskId]) W.history[taskId] = [];
    W.history[taskId].push({
      id: newId(),
      action: action,
      fromStatus: from || null,
      toStatus: to || null,
      note: note || null,
      actorName: actor.name,
      actorRole: actor.role,
      createdAt: nowSql(),
    });
  };

  /** Drop a line in somebody's bell, addressed by user id. */
  var notify = function (userId, n) {
    var target = null;
    Object.keys(W.accounts).forEach(function (email) {
      if (W.accounts[email].user.id === userId) target = W.accounts[email];
    });
    if (!target) return;
    target.notifications.unshift({
      id: newId(),
      type: n.type,
      severity: n.severity || 'info',
      title: n.title,
      body: n.body,
      taskId: n.taskId || null,
      readAt: null,
      createdAt: nowSql(),
    });
  };
  // ------------------------------------------------- chat, mirroring access.js
  // Up and down the line only: a pair is always one rung apart.
  var canTalk = function (a, b) {
    if (!a || !b || a.id === b.id) return false;
    var pair = [a.role, b.role].sort().join('+');
    return pair === 'admin+ceo' || pair === 'admin+user';
  };
  var chatPartners = function (me) {
    return W.users
      .filter(function (u) {
        return u.isActive && canTalk(me, u);
      })
      .sort(function (a, b) {
        var rank = function (r) {
          return r.role === 'ceo' ? 0 : r.role === 'admin' ? 1 : 2;
        };
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  };
  var conversation = function (aId, bId) {
    return W.chat.messages.filter(function (m) {
      return (
        (m.authorId === aId && m.partnerId === bId) || (m.authorId === bId && m.partnerId === aId)
      );
    });
  };
  var chatShape = function (m, meId) {
    return {
      id: m.id,
      body: m.body,
      authorId: m.authorId,
      authorName: m.authorName,
      authorRole: m.authorRole,
      authorRoleLabel: W.roleLabels[m.authorRole],
      mine: m.authorId === meId,
      taskId: m.taskId,
      taskName: m.taskName,
      readAt: m.readAt,
      createdAt: m.createdAt,
    };
  };
  var relationTo = function (me, p) {
    if (p.role === 'ceo') return 'The CEO';
    if (p.role === 'admin') {
      return me.role === 'ceo' ? 'Your manager' : 'Your manager — everything you submit comes here';
    }
    return 'Reports to you';
  };

  var activeWithRole = function (role, exceptId) {
    return W.users.filter(function (u) {
      return u.isActive && u.role === role && u.id !== exceptId;
    });
  };

  // ------------------------------------------------------- list, recomputed
  var filterTasks = function (list, q, me) {
    var out = list.slice();
    if (q.get('mine') === 'true') {
      out = out.filter(function (t) {
        return t.ownerId === me.id;
      });
    }
    if (q.get('ownerId')) {
      out = out.filter(function (t) {
        return t.ownerId === Number(q.get('ownerId'));
      });
    }
    if (q.get('status')) {
      var st = q.get('status').split(',');
      out = out.filter(function (t) {
        return st.indexOf(t.status) !== -1;
      });
    }
    if (q.get('open') === 'true') {
      out = out.filter(isLive);
    }
    if (q.get('priority')) {
      out = out.filter(function (t) {
        return t.priority === q.get('priority');
      });
    }
    if (q.get('client')) {
      out = out.filter(function (t) {
        return t.clientName === q.get('client');
      });
    }
    if (q.get('team')) {
      out = out.filter(function (t) {
        return t.ownerTeam === q.get('team');
      });
    }
    if (q.get('overdue') === 'true') {
      out = out.filter(function (t) {
        return overdueState(t).overdue;
      });
    }
    if (q.get('q')) {
      var s = q.get('q').toLowerCase();
      out = out.filter(function (t) {
        return contains(t.name, s) || contains(t.clientName, s) || contains(t.notes, s);
      });
    }
    var rank = { open: 0, submitted: 1, verified: 2, approved: 3, cancelled: 4 };
    return out.sort(function (a, b) {
      return (
        rank[a.status] - rank[b.status] ||
        (a.priority === 'normal' ? 1 : 0) - (b.priority === 'normal' ? 1 : 0) ||
        String(a.completionDate).localeCompare(String(b.completionDate))
      );
    });
  };

  var userRows = function (me) {
    return W.users.map(function (u) {
      var own = W.tasks.filter(function (t) {
        return t.ownerId === u.id;
      });
      var live = own.filter(isLive);
      var copy = {};
      for (var k in u) copy[k] = u[k];
      copy.openTasks = live.length;
      copy.overdueTasks = live.filter(function (t) {
        return overdueState(t).overdue;
      }).length;
      copy.awaitingReview = own.filter(function (t) {
        return t.status === 'submitted' || t.status === 'verified';
      }).length;
      copy.approvedTasks = own.filter(function (t) {
        return t.status === 'approved';
      }).length;
      return copy;
    });
  };

  var dashboard = function (me) {
    var rows = scoped(me);
    var live = rows.filter(isLive);
    var byStatus = function (s) {
      return rows.filter(function (t) {
        return t.status === s;
      }).length;
    };
    var group = function (keyFn) {
      var map = {};
      var order = [];
      rows.forEach(function (t) {
        var key = keyFn(t) || 'Unassigned';
        if (!map[key]) {
          map[key] = { key: key, live: 0, overdue: 0, awaitingReview: 0, awaitingApproval: 0, approved: 0, total: 0 };
          order.push(key);
        }
        var e = map[key];
        e.total += 1;
        if (isLive(t)) e.live += 1;
        if (overdueState(t).overdue) e.overdue += 1;
        if (t.status === 'submitted') e.awaitingReview += 1;
        if (t.status === 'verified') e.awaitingApproval += 1;
        if (t.status === 'approved') e.approved += 1;
      });
      return order
        .map(function (k) {
          return map[k];
        })
        .sort(function (a, b) {
          return b.live - a.live || b.total - a.total;
        });
    };
    var seeAll = can(me, 'tasks.view_all');

    return {
      scopeLabel: scopeLabel(me),
      ownOnly: ownOnly(me),
      totals: {
        all: rows.length,
        live: live.length,
        open: byStatus('open'),
        submitted: byStatus('submitted'),
        verified: byStatus('verified'),
        approved: byStatus('approved'),
        cancelled: byStatus('cancelled'),
        overdue: live.filter(function (t) {
          return overdueState(t).overdue;
        }).length,
        dueThisWeek: live.filter(function (t) {
          var d = daysToDue(t.completionDate);
          return d !== null && d >= 0 && d <= 7;
        }).length,
        highPriorityLive: live.filter(function (t) {
          return t.priority === 'high';
        }).length,
      },
      stalls: {
        withOwner: live.filter(function (t) {
          return t.status === 'open';
        }).length,
        withVerifier: live.filter(function (t) {
          return t.status === 'submitted';
        }).length,
        withApprover: live.filter(function (t) {
          return t.status === 'verified';
        }).length,
      },
      mine: {
        toDo: rows.filter(function (t) {
          return t.ownerId === me.id && t.status === 'open';
        }).length,
        overdue: rows.filter(function (t) {
          return t.ownerId === me.id && t.status === 'open' && overdueState(t).overdue;
        }).length,
        submitted: rows.filter(function (t) {
          return t.ownerId === me.id && t.status === 'submitted';
        }).length,
        approved: rows.filter(function (t) {
          return t.ownerId === me.id && t.status === 'approved';
        }).length,
      },
      onMyDesk: {
        toVerify: can(me, 'tasks.verify')
          ? rows.filter(function (t) {
              return t.status === 'submitted' && canCheck(t, me);
            }).length
          : 0,
        toApprove: can(me, 'tasks.approve')
          ? rows.filter(function (t) {
              return t.status === 'verified' && t.ownerId !== me.id;
            }).length
          : 0,
      },
      byPerson: seeAll
        ? group(function (t) {
            return t.ownerName;
          })
        : [],
      byClient: seeAll
        ? group(function (t) {
            return t.clientName;
          })
        : [],
      byTeam: seeAll
        ? group(function (t) {
            return t.ownerTeam;
          })
        : [],
      attention: live
        .map(function (t) {
          return { t: t, d: daysToDue(t.completionDate) };
        })
        .sort(function (a, b) {
          return a.d - b.d || (a.t.priority === 'high' ? -1 : 1);
        })
        .slice(0, 6)
        .map(function (x) {
          return {
            id: x.t.id,
            name: x.t.name,
            clientName: x.t.clientName,
            ownerName: x.t.ownerName,
            status: x.t.status,
            priority: x.t.priority,
            completionDate: x.t.completionDate,
            daysToDue: x.d,
            isOverdue: overdueState(x.t).overdue,
          };
        }),
      generatedFor: today(),
    };
  };

  // -------------------------------------------------------- the four moves
  /**
   * One place where a status changes, as on the server: guard, then columns,
   * then the activity row, then whoever needs telling.
   */
  var move = function (t, me, spec) {
    var a = actionsFor(t, me);
    var refusal = spec.allow(a, t, me);
    if (refusal) return json({ error: refusal.error }, refusal.status);

    var next = spec.apply(t, me, spec.note, nowSql());
    var from = t.status;
    for (var k in next) t[k] = next[k];
    t.updatedAt = nowSql();
    record(t.id, me, spec.event, from, next.status || from, spec.note);
    if (spec.notify) spec.notify(t, me, spec.note);
    return json({ task: shape(t, me) });
  };

  var TRANSITIONS = {
    submit: {
      event: 'submitted',
      allow: function (a, t, u) {
        if (a.canSubmit) return null;
        if (t.ownerId !== u.id) {
          return {
            status: 403,
            error:
              'Only the person who owns a task can submit it. That is the point of the two checks that follow.',
          };
        }
        return { status: 409, error: 'This task is already ' + STATUS_LABEL[t.status].toLowerCase() };
      },
      apply: function (t, me, note, stamp) {
        return {
          status: 'submitted',
          submittedAt: stamp,
          submittedNote: note,
          returnedAt: null,
          returnerName: null,
          returnReason: null,
        };
      },
      notify: function (t, me) {
        var checkers = hasOtherChecker(t.ownerId)
          ? activeWithRole('admin', me.id)
          : activeWithRole('ceo', me.id);
        checkers.forEach(function (v) {
          notify(v.id, {
            type: 'task_submitted',
            title: 'To check: ' + t.name,
            body: me.name + ' marked this done for ' + t.clientName + '.',
            taskId: t.id,
          });
        });
      },
    },

    verify: {
      event: 'verified',
      allow: function (a, t, u) {
        if (a.canVerify) return null;
        if (t.ownerId === u.id) return { status: 403, error: 'You cannot verify your own work' };
        if (t.status !== 'submitted') {
          return { status: 409, error: 'Nothing to verify — this task is ' + t.status };
        }
        return { status: 403, error: 'Your role cannot verify tasks' };
      },
      apply: function (t, me, note, stamp) {
        // The CEO's own tasks have nobody above them, so verification is the
        // last gate rather than leaving the task stuck.
        if (!hasOtherApprover(t.ownerId)) {
          return {
            status: 'approved',
            verifiedAt: stamp,
            verifierName: me.name,
            verifiedNote: note,
            approvedAt: stamp,
            approverName: me.name,
            approvedNote: 'Completed on verification — the owner is the approver.',
          };
        }
        return { status: 'verified', verifiedAt: stamp, verifierName: me.name, verifiedNote: note };
      },
      notify: function (t, me) {
        if (t.status === 'approved') {
          notify(t.ownerId, {
            type: 'task_approved',
            title: 'Approved: ' + t.name,
            body: me.name + ' signed this off.',
            taskId: t.id,
          });
          return;
        }
        activeWithRole('ceo', t.ownerId).forEach(function (c) {
          notify(c.id, {
            type: 'task_verified',
            title: 'Ready for approval: ' + t.name,
            body: me.name + ' verified this. ' + t.ownerName + ' did the work.',
            taskId: t.id,
          });
        });
        notify(t.ownerId, {
          type: 'task_verified',
          title: 'Verified: ' + t.name,
          body: me.name + ' checked it over. Waiting on final approval.',
          taskId: t.id,
        });
      },
    },

    approve: {
      event: 'approved',
      allow: function (a, t, u) {
        if (a.canApprove) return null;
        if (t.ownerId === u.id) return { status: 403, error: 'You cannot approve your own work' };
        if (t.status !== 'verified') {
          return {
            status: 409,
            error:
              t.status === 'submitted'
                ? 'An admin needs to verify this first'
                : 'Nothing to approve — this task is ' + t.status,
          };
        }
        return { status: 403, error: 'Only the CEO gives final approval' };
      },
      apply: function (t, me, note, stamp) {
        return { status: 'approved', approvedAt: stamp, approverName: me.name, approvedNote: note };
      },
      notify: function (t, me) {
        notify(t.ownerId, {
          type: 'task_approved',
          title: 'Approved: ' + t.name,
          body: me.name + ' signed this off.' + (t.approvedNote ? ' “' + t.approvedNote + '”' : ''),
          taskId: t.id,
        });
      },
    },

    return: {
      event: 'returned',
      allow: function (a, t, u) {
        if (a.canReturn) return null;
        if (t.ownerId === u.id) {
          return { status: 403, error: 'You cannot send your own task back to yourself' };
        }
        if (['submitted', 'verified'].indexOf(t.status) === -1) {
          return { status: 409, error: 'Only a submitted or verified task can be sent back' };
        }
        return { status: 403, error: 'Your role cannot send this back' };
      },
      apply: function (t, me, note, stamp) {
        return {
          status: 'open',
          returnedAt: stamp,
          returnerName: me.name,
          returnReason: note,
          returnCount: (t.returnCount || 0) + 1,
          submittedAt: null,
          submittedNote: null,
          verifiedAt: null,
          verifierName: null,
          verifiedNote: null,
        };
      },
      notify: function (t, me, note) {
        notify(t.ownerId, {
          type: 'task_returned',
          severity: 'warning',
          title: 'Sent back: ' + t.name,
          body: me.name + ': “' + note + '”',
          taskId: t.id,
        });
      },
    },

    reopen: {
      event: 'reopened',
      allow: function (a, t) {
        return a.canReopen
          ? null
          : { status: 409, error: 'Only an approved task can be reopened — this one is ' + t.status };
      },
      apply: function (t, me, note, stamp) {
        return {
          status: 'open',
          approvedAt: null,
          approverName: null,
          approvedNote: null,
          verifiedAt: null,
          verifierName: null,
          verifiedNote: null,
          submittedAt: null,
          submittedNote: null,
          returnedAt: stamp,
          returnerName: me.name,
          returnReason: note || 'Reopened after approval.',
          returnCount: (t.returnCount || 0) + 1,
        };
      },
      notify: function (t, me, note) {
        notify(t.ownerId, {
          type: 'task_returned',
          severity: 'warning',
          title: 'Reopened: ' + t.name,
          body: note ? me.name + ': “' + note + '”' : me.name + ' reopened this after approval.',
          taskId: t.id,
        });
      },
    },

    cancel: {
      event: 'cancelled',
      allow: function (a, t) {
        return a.canCancel ? null : { status: 409, error: 'A ' + t.status + ' task cannot be cancelled' };
      },
      apply: function (t, me, note, stamp) {
        return { status: 'cancelled', cancelledAt: stamp, cancelReason: note };
      },
      notify: function (t, me, note) {
        if (t.ownerId === me.id) return;
        notify(t.ownerId, {
          type: 'task_cancelled',
          title: 'Cancelled: ' + t.name,
          body: note ? me.name + ': “' + note + '”' : me.name + ' cancelled this.',
          taskId: t.id,
        });
      },
    },
  };

  // -------------------------------------------------------------- the shim
  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (String(url).indexOf('/api/') === -1) return realFetch(input, init);

    var method = ((init && init.method) || 'GET').toUpperCase();
    var parsed = new URL(url, window.location.origin);
    var route = parsed.pathname.replace(/^.*\/api/, '');
    var q = parsed.searchParams;

    var raw = init && init.body;
    var isForm = typeof FormData !== 'undefined' && raw instanceof FormData;
    var body = {};
    if (raw && !isForm) {
      try {
        body = JSON.parse(raw);
      } catch (e) {
        body = {};
      }
    }

    // --- sign in ---------------------------------------------------------
    if (route === '/auth/login' && method === 'POST') {
      var email = String(body.email || '').trim().toLowerCase();
      if (!W.accounts[email]) {
        return json({ error: 'Unknown account. Use one of the demo accounts listed below.' }, 401);
      }
      session = email;
      return json({ token: 'preview-' + email, user: W.accounts[email].user });
    }

    if (!session) return json({ error: 'Not signed in' }, 401);
    var acct = W.accounts[session];
    var me = acct.user;

    if (route === '/auth/me' && method === 'GET') return json({ user: me });
    if (route === '/auth/me' && method === 'PATCH') {
      if (body.newPassword) {
        return json(
          { error: 'Passwords cannot be changed in this preview — there is no database behind it.' },
          403
        );
      }
      if (body.name) me.name = String(body.name).trim();
      if (body.reminderDaysBefore !== undefined) {
        me.reminderDaysBefore = Number(body.reminderDaysBefore);
      }
      return json({ user: me });
    }

    // --- reads -----------------------------------------------------------
    if (method === 'GET') {
      if (route === '/users') {
        return json({ users: userRows(me), canManage: can(me, 'team.manage'), teams: W.teams });
      }
      if (route === '/users/roles') return json({ roles: W.roles });
      if (route === '/users/teams') return json({ teams: W.teams });
      if (route === '/dashboard') return json(dashboard(me));

      if (route === '/tasks') {
        var limit = Number(q.get('limit'));
        var list = filterTasks(scoped(me), q, me);
        if (Number.isFinite(limit) && limit > 0) list = list.slice(0, Math.min(limit, 500));
        return json({
          tasks: list.map(function (t) {
            return shape(t, me);
          }),
          canCreate: can(me, 'tasks.create'),
          ownOnly: ownOnly(me),
        });
      }

      if (route === '/tasks/clients') {
        var counts = {};
        var order = [];
        scoped(me).forEach(function (t) {
          if (!counts[t.clientName]) {
            counts[t.clientName] = 0;
            order.push(t.clientName);
          }
          counts[t.clientName] += 1;
        });
        return json({
          clients: order
            .map(function (name) {
              return { name: name, tasks: counts[name] };
            })
            .sort(function (a, b) {
              return b.tasks - a.tasks || a.name.localeCompare(b.name);
            }),
        });
      }

      if (route === '/tasks/queue') {
        var mineOpen = W.tasks.filter(function (t) {
          return t.ownerId === me.id && t.status === 'open';
        });
        var out = { toDo: [], toVerify: [], toApprove: [] };
        out.toDo = mineOpen
          .sort(function (a, b) {
            return String(a.completionDate).localeCompare(String(b.completionDate));
          })
          .map(function (t) {
            return shape(t, me);
          });
        if (can(me, 'tasks.verify')) {
          out.toVerify = W.tasks
            .filter(function (t) {
              return t.status === 'submitted' && canCheck(t, me);
            })
            .map(function (t) {
              return shape(t, me);
            });
        }
        if (can(me, 'tasks.approve')) {
          out.toApprove = W.tasks
            .filter(function (t) {
              return t.status === 'verified' && t.ownerId !== me.id;
            })
            .map(function (t) {
              return shape(t, me);
            });
        }
        return json(out);
      }

      var detail = route.match(/^\/tasks\/(\d+)$/);
      if (detail) {
        var dt = findTask(detail[1]);
        if (!dt) return json({ error: 'Task not found' }, 404);
        if (!inScope(me, dt)) return json({ error: 'No access to that task' }, 403);
        var files = (W.attachments[dt.id] || []).map(function (a) {
          var copy = {};
          for (var k in a) copy[k] = a[k];
          copy.canDelete = a.uploadedById === me.id || can(me, 'tasks.edit');
          return copy;
        });
        return json({ task: shape(dt, me), attachments: files, history: W.history[dt.id] || [] });
      }

      if (route === '/chat/threads') {
        var threads = chatPartners(me).map(function (p) {
          var msgs = conversation(me.id, p.id);
          var last = msgs[msgs.length - 1] || null;
          return {
            partnerId: p.id,
            name: p.name,
            role: p.role,
            roleLabel: p.roleLabel || W.roleLabels[p.role],
            team: p.team,
            title: p.title,
            relation: relationTo(me, p),
            lastBody: last ? last.body : null,
            lastAt: last ? last.createdAt : null,
            lastFromMe: last ? last.authorId === me.id : null,
            unread: msgs.filter(function (m) {
              return m.authorId === p.id && !m.readAt;
            }).length,
          };
        });
        threads.sort(function (a, b) {
          return (
            b.unread - a.unread ||
            String(b.lastAt || '').localeCompare(String(a.lastAt || '')) ||
            a.name.localeCompare(b.name)
          );
        });
        return json({
          threads: threads,
          unreadTotal: threads.reduce(function (n, t) {
            return n + t.unread;
          }, 0),
          rule:
            me.role === 'admin'
              ? 'You are the middle of the line: the CEO above, your team below.'
              : me.role === 'ceo'
                ? 'You talk to your manager. Their team talks to them.'
                : 'You talk to your manager. They take it up from there.',
        });
      }

      var withMatch = route.match(/^\/chat\/with\/(\d+)$/);
      if (withMatch) {
        var other = findUser(withMatch[1]);
        if (!other) return json({ error: 'No such person' }, 404);
        if (!canTalk(me, other)) {
          return json(
            {
              error:
                other.role === me.role
                  ? 'Messages travel up and down the line, not sideways. Send this to your manager.'
                  : 'That would skip a rung. Send it to your manager and they will carry it up.',
            },
            403
          );
        }
        // Opening the thread is what "read" means here, same as the server.
        conversation(me.id, other.id).forEach(function (m) {
          if (m.authorId === other.id && !m.readAt) m.readAt = nowSql();
        });
        return json({
          partner: {
            id: other.id,
            name: other.name,
            role: other.role,
            roleLabel: other.roleLabel || W.roleLabels[other.role],
            team: other.team,
            title: other.title,
            isActive: other.isActive,
          },
          messages: conversation(me.id, other.id).map(function (m) {
            return chatShape(m, me.id);
          }),
        });
      }

      // The preview has no server and no file — it says so plainly rather than
      // erroring, so the Settings screen renders either way.
      if (route === '/store') {
        return json({
          mode: 'preview',
          file: 'bundled into this HTML file',
          exists: true,
          unsaved: false,
          problems: [],
          conflicts: [],
          attachmentsDir: '—',
        });
      }

      if (route === '/notifications') {
        var all = acct.notifications;
        var asleep = function (n) {
          return n.snoozedUntil && n.snoozedUntil > nowSql();
        };
        var list2 = all.filter(function (n) {
          return q.get('snoozed') === 'true' ? asleep(n) : !asleep(n);
        });
        if (q.get('unread') === 'true') {
          list2 = list2.filter(function (n) {
            return !n.readAt;
          });
        }
        var unread = all.filter(function (n) {
          return !n.readAt && !asleep(n);
        });
        return json({
          notifications: list2,
          unread: unread.length,
          critical: unread.filter(function (n) {
            return n.severity === 'critical';
          }).length,
          snoozed: all.filter(asleep).length,
          presets: SNOOZE_PRESETS,
        });
      }
    }

    // --- the bell --------------------------------------------------------
    var readOne = route.match(/^\/notifications\/(\d+)\/read$/);
    if (readOne && method === 'POST') {
      acct.notifications.forEach(function (n) {
        if (String(n.id) === readOne[1]) n.readAt = nowSql();
      });
      return json({ ok: true });
    }
    if (route === '/notifications/read-all' && method === 'POST') {
      var marked = 0;
      acct.notifications.forEach(function (n) {
        // Not the ones deliberately put off — same rule as the server.
        if (!n.readAt && !(n.snoozedUntil && n.snoozedUntil > nowSql())) {
          n.readAt = nowSql();
          marked += 1;
        }
      });
      return json({ ok: true, marked: marked });
    }
    var snoozeOne = route.match(/^\/notifications\/(\d+)\/snooze$/);
    if (snoozeOne && method === 'POST') {
      var preset = (body && body.preset) || 'tomorrow';
      var chosen = null;
      SNOOZE_PRESETS.forEach(function (p) {
        if (p.key === preset) chosen = p;
      });
      if (!chosen) return json({ error: 'Unknown snooze option' }, 400);
      var until = snoozeUntil(preset);
      acct.notifications.forEach(function (n) {
        if (String(n.id) === snoozeOne[1]) {
          n.snoozedUntil = until;
          n.readAt = null;
        }
      });
      return json({ ok: true, snoozedUntil: until, label: chosen.label });
    }
    var wakeOne = route.match(/^\/notifications\/(\d+)\/unsnooze$/);
    if (wakeOne && method === 'POST') {
      acct.notifications.forEach(function (n) {
        if (String(n.id) === wakeOne[1]) n.snoozedUntil = null;
      });
      return json({ ok: true });
    }

    // --- send a message --------------------------------------------------
    var sendMatch = route.match(/^\/chat\/with\/(\d+)$/);
    if (sendMatch && method === 'POST') {
      var to = findUser(sendMatch[1]);
      if (!to) return json({ error: 'No such person' }, 404);
      if (!canTalk(me, to)) {
        return json({ error: 'You cannot open a thread with that person' }, 403);
      }
      var text = String(body.body || '').trim();
      // A message may be nothing but a file, as on the server — though in the
      // preview the file itself will be turned away a moment later.
      if (!text && !body.willAttach) return json({ error: 'Write something first' }, 400);
      var msg = {
        id: newId(),
        body: text,
        authorId: me.id,
        authorName: me.name,
        authorRole: me.role,
        partnerId: to.id,
        taskId: null,
        taskName: null,
        readAt: null,
        createdAt: nowSql(),
      };
      W.chat.messages.push(msg);
      notify(to.id, {
        type: 'chat_message',
        title: 'Message from ' + me.name,
        body: text.length > 140 ? text.slice(0, 137) + '…' : text,
      });
      return json({ message: chatShape(msg, me.id) }, 201);
    }

    // --- create ----------------------------------------------------------
    if (route === '/tasks' && method === 'POST') {
      if (!can(me, 'tasks.create')) {
        return json({ error: 'Your role cannot create tasks' }, 403);
      }
      var missing = ['name', 'clientName', 'ownerId', 'completionDate'].filter(function (f) {
        return !body[f];
      });
      if (missing.length) return json({ error: missing[0] + ' is required' }, 400);
      var owner = findUser(body.ownerId);
      if (!owner || !owner.isActive) {
        return json({ error: 'Pick an active person to own this' }, 400);
      }
      if (String(body.completionDate) < today()) {
        return json({ error: 'The completion date cannot be in the past' }, 400);
      }
      var nm = String(body.name).trim();
      if (nm.length < 3) {
        return json({ error: 'Give the task a name somebody will recognise later' }, 400);
      }
      var created = {
        id: newId(),
        name: nm,
        clientName: String(body.clientName).trim(),
        ownerId: owner.id,
        ownerName: owner.name,
        ownerTeam: owner.team,
        completionDate: body.completionDate,
        priority: body.priority || 'normal',
        notes: body.notes ? String(body.notes).trim() : null,
        status: 'open',
        createdById: me.id,
        creatorName: me.name,
        submittedAt: null,
        submittedNote: null,
        verifiedAt: null,
        verifierName: null,
        verifiedNote: null,
        approvedAt: null,
        approverName: null,
        approvedNote: null,
        returnedAt: null,
        returnerName: null,
        returnReason: null,
        returnCount: 0,
        cancelledAt: null,
        cancelReason: null,
        reassignedAt: null,
        reassignCount: 0,
        attachmentCount: 0,
        createdAt: nowSql(),
      };
      W.tasks.unshift(created);
      record(
        created.id,
        me,
        'created',
        null,
        'open',
        'Assigned to ' + owner.name + ', due ' + created.completionDate
      );
      if (owner.id !== me.id) {
        notify(owner.id, {
          type: 'task_assigned',
          severity: created.priority === 'high' ? 'warning' : 'info',
          title: 'New task: ' + created.name,
          body:
            me.name + ' assigned this to you for ' + created.clientName +
            '. Due ' + created.completionDate + '.',
          taskId: created.id,
        });
      }
      return json({ task: shape(created, me) }, 201);
    }

    // --- edit ------------------------------------------------------------
    var patchTask = route.match(/^\/tasks\/(\d+)$/);
    if (patchTask && method === 'PATCH') {
      var pt = findTask(patchTask[1]);
      if (!pt) return json({ error: 'Task not found' }, 404);
      if (!inScope(me, pt)) return json({ error: 'No access to that task' }, 403);
      var pa = actionsFor(pt, me);
      var notesOnly = Object.keys(body).every(function (k) {
        return k === 'notes';
      });
      if (!pa.canEdit && !(notesOnly && pt.ownerId === me.id)) {
        return json({ error: 'You cannot change that task' }, 403);
      }
      var changes = [];
      var reassignment = null;
      if (body.notes !== undefined) pt.notes = body.notes ? String(body.notes).trim() : null;
      if (pa.canEdit) {
        if (body.name !== undefined) {
          if (String(body.name).trim().length < 3) {
            return json({ error: 'Give the task a name somebody will recognise later' }, 400);
          }
          pt.name = String(body.name).trim();
          changes.push('name');
        }
        if (body.clientName !== undefined) {
          pt.clientName = String(body.clientName).trim();
          changes.push('client');
        }
        if (body.priority !== undefined) {
          pt.priority = body.priority;
          changes.push('priority → ' + body.priority);
        }
        if (body.completionDate !== undefined) {
          pt.completionDate = body.completionDate;
          changes.push('due date → ' + body.completionDate);
        }
        // Reassignment gets its own history entry, not a line inside "edited"
        // — same rule as the server, for the same reason.
        if (body.ownerId !== undefined && Number(body.ownerId) !== pt.ownerId) {
          if (!pa.canReassign) return json({ error: 'Your role cannot reassign tasks' }, 403);
          var no = findUser(body.ownerId);
          if (!no || !no.isActive) return json({ error: 'Pick an active person' }, 400);
          var wasSubmitted = pt.status === 'submitted';
          var reason = body.reassignReason ? String(body.reassignReason).trim() : null;
          reassignment = {
            from: pt.ownerName,
            fromId: pt.ownerId,
            to: no.name,
            toId: no.id,
            reason: reason,
            wasSubmitted: wasSubmitted,
            fromStatus: pt.status,
          };
          pt.ownerId = no.id;
          pt.ownerName = no.name;
          pt.ownerTeam = no.team;
          pt.reassignedAt = nowSql();
          pt.reassignCount = (pt.reassignCount || 0) + 1;
          if (wasSubmitted) {
            pt.status = 'open';
            pt.submittedAt = null;
            pt.submittedNote = null;
          }
        }
      }
      pt.updatedAt = nowSql();
      if (changes.length) {
        record(pt.id, me, 'edited', pt.status, pt.status, changes.join(', '));
      }
      if (reassignment) {
        record(
          pt.id,
          me,
          'reassigned',
          reassignment.fromStatus,
          pt.status,
          'From ' +
            reassignment.from +
            ' to ' +
            reassignment.to +
            (reassignment.reason ? ' — ' + reassignment.reason : '') +
            (reassignment.wasSubmitted ? ' (it was marked done, so it is open again)' : '')
        );
        notify(reassignment.toId, {
          type: 'task_reassigned',
          title: 'Handed to you: ' + pt.name,
          body:
            me.name + ' moved this from ' + reassignment.from + ' to you. Due ' +
            pt.completionDate + '.' + (reassignment.reason ? ' “' + reassignment.reason + '”' : ''),
          taskId: pt.id,
        });
        if (reassignment.fromId !== me.id) {
          notify(reassignment.fromId, {
            type: 'task_reassigned',
            title: 'Moved off your list: ' + pt.name,
            body:
              me.name + ' reassigned this to ' + reassignment.to + '.' +
              (reassignment.reason ? ' “' + reassignment.reason + '”' : ''),
            taskId: pt.id,
          });
        }
      }
      return json({ task: shape(pt, me) });
    }

    // --- the four moves, plus reopen and cancel --------------------------
    var moveMatch = route.match(/^\/tasks\/(\d+)\/(submit|verify|approve|return|reopen|cancel)$/);
    if (moveMatch && method === 'POST') {
      var mt = findTask(moveMatch[1]);
      if (!mt) return json({ error: 'Task not found' }, 404);
      if (!inScope(me, mt)) return json({ error: 'No access to that task' }, 403);
      var kind = moveMatch[2];
      var note = body.note ? String(body.note).trim() : null;
      if (kind === 'return' && (!note || note.length < 5)) {
        return json(
          { error: 'Say what needs doing — a task sent back without a reason just stalls' },
          400
        );
      }
      if (kind === 'cancel' && !can(me, 'tasks.cancel')) {
        return json({ error: 'Your role cannot cancel tasks' }, 403);
      }
      if (kind === 'reopen' && !can(me, 'tasks.reopen')) {
        return json({ error: 'Only the CEO can reopen an approved task' }, 403);
      }
      var spec = TRANSITIONS[kind];
      return move(mt, me, {
        event: spec.event,
        note: note,
        allow: spec.allow,
        apply: spec.apply,
        notify: spec.notify,
      });
    }

    // --- attachments -----------------------------------------------------
    var NO_FILES =
      'Files cannot be uploaded in this preview — there is no server to keep them. ' +
      'Run the app locally and attachments work as normal.';

    var upload = route.match(/^\/attachments\/task\/(\d+)$/);
    if (upload && method === 'POST') return json({ error: NO_FILES }, 403);

    if (/^\/chat\/messages\/\d+\/attachments$/.test(route) && method === 'POST') {
      return json({ error: NO_FILES }, 403);
    }
    if (/^\/chat\/attachments\/\d+$/.test(route)) {
      return json(
        { error: 'The file itself is not bundled into this preview — only its record is.' },
        403
      );
    }
    var oneFile = route.match(/^\/attachments\/(\d+)$/);
    if (oneFile && method === 'GET') {
      return json(
        { error: 'The file itself is not bundled into this preview — only its record is.' },
        403
      );
    }
    if (oneFile && method === 'DELETE') {
      var removed = false;
      Object.keys(W.attachments).forEach(function (tid) {
        var before = W.attachments[tid].length;
        W.attachments[tid] = W.attachments[tid].filter(function (a) {
          var keep = String(a.id) !== oneFile[1] || !(a.uploadedById === me.id || can(me, 'tasks.edit'));
          return keep;
        });
        if (W.attachments[tid].length !== before) {
          removed = true;
          var host = findTask(tid);
          if (host) host.attachmentCount = W.attachments[tid].length;
        }
      });
      return removed
        ? json({ ok: true })
        : json({ error: 'You cannot remove that file' }, 403);
    }

    // --- people ----------------------------------------------------------
    if (route === '/users' && method === 'POST') {
      if (!can(me, 'team.manage')) return json({ error: 'Your role cannot manage people' }, 403);
      if (!body.name || !body.email || !body.password) {
        return json({ error: 'Name, email and a password are all required' }, 400);
      }
      var added = {
        id: newId(),
        name: String(body.name).trim(),
        email: String(body.email).trim().toLowerCase(),
        role: body.role || 'user',
        roleLabel: W.roleLabels[body.role || 'user'],
        team: body.team || null,
        title: body.title || null,
        isActive: true,
        openTasks: 0,
        overdueTasks: 0,
        awaitingReview: 0,
        approvedTasks: 0,
        createdAt: nowSql(),
      };
      W.users.push(added);
      return json({ user: added }, 201);
    }
    var patchUser = route.match(/^\/users\/(\d+)$/);
    if (patchUser && method === 'PATCH') {
      if (!can(me, 'team.manage')) return json({ error: 'Your role cannot manage people' }, 403);
      var tu = findUser(patchUser[1]);
      if (!tu) return json({ error: 'User not found' }, 404);
      if (tu.role === 'ceo' && me.role !== 'ceo') {
        return json({ error: 'The CEO account cannot be edited here' }, 403);
      }
      if (body.isActive === false) {
        var holds = W.tasks.filter(function (t) {
          return t.ownerId === tu.id && isLive(t);
        }).length;
        if (holds) {
          return json(
            {
              error:
                tu.name + ' still owns ' + holds + ' live ' + (holds === 1 ? 'task' : 'tasks') +
                '. Hand those over first, then deactivate.',
            },
            400
          );
        }
      }
      if (body.name !== undefined) tu.name = String(body.name).trim();
      if (body.title !== undefined) tu.title = body.title || null;
      if (body.team !== undefined) tu.team = body.team || null;
      if (body.role !== undefined) {
        tu.role = body.role;
        tu.roleLabel = W.roleLabels[body.role];
      }
      if (body.isActive !== undefined) tu.isActive = Boolean(body.isActive);
      return json({ user: tu });
    }

    return json({ error: 'That is not available in this preview.' }, 404);
  };

  // A quiet, permanent note of what this file is.
  window.addEventListener('DOMContentLoaded', function () {
    var chip = document.createElement('div');
    // Says the two things somebody trying the demo needs to know: what they do
    // here is real within the tab, and switching people is a Sign out — a
    // reload starts the whole demo over.
    chip.textContent = 'Interface preview · changes last until you reload';
    chip.setAttribute(
      'style',
      'position:fixed;right:14px;bottom:14px;z-index:9999;padding:6px 11px;' +
        'border-radius:20px;font:500 11.5px system-ui,-apple-system,sans-serif;' +
        'background:var(--surface-raised,#fff);color:var(--ink-muted,#898781);' +
        'border:1px solid var(--border,rgba(0,0,0,.1));box-shadow:0 2px 10px rgba(0,0,0,.08);' +
        'pointer-events:none;opacity:.9'
    );
    document.body.appendChild(chip);
  });
})();
