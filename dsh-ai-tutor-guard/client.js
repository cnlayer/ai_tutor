// ai_tutor 家长监护 bundle 的 client 半边（v1.2）。
//
// tutor preset 隐藏了会话侧边栏，"新对话 / 清空历史"入口放进会话头部操作区
// （slot `conversation.session.header.actions`）。
//
// 清空历史 = 把当前工作区（按 cwd 过滤，绝不触碰其他工作区）的全部会话
// `archiveSession(stopActivity:true)` 归档，再开一个新会话；日志文件的物理
// 删除由 host 半边（index.js）在 `workspace/session-stop` 事件里完成，
// 当前会话的文件由 host 记入待删清单，最迟在下次启动时删除。
// 两步确认（无 PIN，按产品决定）：点"清空历史"→"确认清空"，6 秒未确认自动取消。

window.__ModuleLoader__.load({
  id: '@local/dsh-ai-tutor-guard',
  factory(require) {
    const react = require('react');
    const h = react.createElement;

    return {
      inject: ['slots', 'uiWorkspace'],
      apply(ctx) {
        function HistoryActions({ sessionId, useSessions, useWorkspaces }) {
          const ids = useSessions((s) => s.ids);
          const byId = useSessions((s) => s.byId);
          const items = useWorkspaces((w) => w.items);
          const [phase, setPhase] = react.useState('idle'); // idle | confirm | busy
          const [note, setNote] = react.useState('');

          // 确认态 6 秒未确认自动回到 idle，避免误点后搁置一个危险操作。
          react.useEffect(() => {
            if (phase !== 'confirm') return;
            const timer = setTimeout(() => setPhase('idle'), 6000);
            return () => clearTimeout(timer);
          }, [phase]);

          const workspace = items.find((item) => item.sessionIds.includes(sessionId));

          const newChat = () => {
            ctx.uiWorkspace.startSession(workspace?.workspaceId);
          };

          const clearHistory = async () => {
            setPhase('busy');
            setNote('');
            // 只清理当前工作区的会话：workspace.sessionIds 为主，cwd 相同兜底。
            const targets = new Set(workspace ? workspace.sessionIds : []);
            const cwd = workspace?.path ?? byId[sessionId]?.cwd;
            if (cwd) {
              for (const id of ids) {
                if (byId[id]?.cwd === cwd) targets.add(id);
              }
            }
            targets.add(sessionId);
            let failed = 0;
            for (const id of targets) {
              try {
                await ctx.uiWorkspace.archiveSession(id, { stopActivity: true });
              } catch {
                failed += 1;
              }
            }
            if (failed) setNote(`${failed} 个会话未能清理`);
            setPhase('idle');
            ctx.uiWorkspace.startSession(workspace?.workspaceId);
          };

          const baseStyle = {
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            borderRadius: 6,
            padding: '3px 10px',
            fontSize: 12,
            lineHeight: '18px',
            cursor: 'pointer',
          };
          const dangerStyle = {
            ...baseStyle,
            color: 'var(--dsw-alias-state-error-primary)',
            borderColor: 'var(--dsw-alias-state-error-primary)',
          };

          if (phase === 'confirm') {
            return h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
              h(
                'span',
                { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                '清空全部历史？不可恢复',
              ),
              h('button', { style: dangerStyle, onClick: clearHistory }, '确认清空'),
              h('button', { style: baseStyle, onClick: () => setPhase('idle') }, '取消'),
            );
          }
          return h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
            h(
              'button',
              { style: baseStyle, disabled: phase === 'busy', onClick: newChat },
              '新对话',
            ),
            h(
              'button',
              {
                style: baseStyle,
                disabled: phase === 'busy',
                onClick: () => setPhase('confirm'),
              },
              phase === 'busy' ? '清理中…' : '清空历史',
            ),
            note
              ? h(
                  'span',
                  { style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)' } },
                  note,
                )
              : null,
          );
        }

        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'ai-tutor-history', order: 30 },
            HistoryActions,
          ),
        );
      },
    };
  },
});
