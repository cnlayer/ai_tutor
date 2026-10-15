window.__ModuleLoader__.load({
  id: '@local/dsh-ai-tutor-kid',
  factory(require) {
    const react = require('react');
    const CSS = [
      // —— 隐藏左侧栏列与拖拽手柄；网格首列归零（后缀选择器跨构建哈希稳定）——
      // 注意：sidebarCol 不能用 display:none，否则中列会顶替它的网格轨道被压成 0 宽。
      '[class$="_frame"]:has([class$="_centerCol"]){grid-template-columns:0px minmax(0,1fr) 0px !important}',
      '[class$="_sidebarCol"]{min-width:0 !important;border-right:none !important}',
      '[class$="_handle"][data-side="sidebar"]{display:none !important}',
      // —— 欢迎页工作区选择行（chip + 选择器）——
      '[class$="_heroWorkspaceRow"]{display:none !important}',
      // —— 彻底隐藏思考链（进行中与完成轮的 reasoning disclosure 都带 data-variant="think"）——
      '[data-variant="think"]{display:none !important}',
    ].join('\n');

    const h = react.createElement;
    const MARK_COLOR = '#ff3b30';

    // —— 相机按钮：挂在输入框工具条 conversation.input.left ——
    function CameraSeat() {
      const [open, setOpen] = react.useState(false);
      const [stage, setStage] = react.useState('camera'); // camera | edit
      const [facing, setFacing] = react.useState('environment');
      const [error, setError] = react.useState('');
      const [ready, setReady] = react.useState(false);
      const [mode, setMode] = react.useState('draw'); // draw(圈选) | crop(剪切)
      const [marks, setMarks] = react.useState([]); // 椭圆 {x0,y0,x1,y1}，原图像素坐标
      const [crop, setCrop] = react.useState(null); // 待应用裁剪框
      const videoRef = react.useRef(null);
      const streamRef = react.useRef(null);
      const shotRef = react.useRef(null); // {canvas} 已拍摄的帧
      const draftRef = react.useRef(null); // 拖拽中的临时框
      const previewRef = react.useRef(null);
      const [version, setVersion] = react.useState(0);

      const stopStream = () => {
        if (streamRef.current !== null) {
          for (const track of streamRef.current.getTracks()) track.stop();
          streamRef.current = null;
        }
        setReady(false);
      };

      const resetAll = () => {
        setStage('camera');
        setMarks([]);
        setCrop(null);
        setMode('draw');
        setError('');
        shotRef.current = null;
        draftRef.current = null;
      };

      react.useEffect(() => {
        if (!open) {
          resetAll();
          return undefined;
        }
        if (stage !== 'camera') return undefined;
        let cancelled = false;
        setError('');
        if (typeof navigator.mediaDevices === 'undefined' || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          setError('当前环境不支持摄像头（需要 https 或 127.0.0.1 访问）');
          return () => { cancelled = true; };
        }
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
          .then((stream) => {
            if (cancelled) {
              for (const track of stream.getTracks()) track.stop();
              return;
            }
            streamRef.current = stream;
            if (videoRef.current !== null) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(() => {});
            }
            setReady(true);
          })
          .catch((err) => {
            const name = err && err.name;
            if (name === 'NotAllowedError') setError('相机权限被拒绝：请在浏览器地址栏把摄像头设为「允许」后重试');
            else if (name === 'NotFoundError') setError('未检测到摄像头设备');
            else setError('无法打开摄像头：' + String((err && err.message) || err));
          });
        return () => {
          cancelled = true;
          stopStream();
        };
      }, [open, stage, facing]);

      // —— 编辑画布重绘 ——
      const redraw = react.useCallback(() => {
        const c = previewRef.current;
        const shot = shotRef.current;
        if (c === null || shot === null) return;
        const ctx2d = c.getContext('2d');
        ctx2d.clearRect(0, 0, c.width, c.height);
        ctx2d.drawImage(shot.canvas, 0, 0);
        const lw = Math.max(3, Math.round(c.width / 300));
        const ellipse = (m, dashed) => {
          ctx2d.save();
          ctx2d.strokeStyle = MARK_COLOR;
          ctx2d.lineWidth = lw;
          if (dashed) ctx2d.setLineDash([10, 8]);
          ctx2d.beginPath();
          ctx2d.ellipse((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, Math.abs(m.x1 - m.x0) / 2 || 1, Math.abs(m.y1 - m.y0) / 2 || 1, 0, 0, Math.PI * 2);
          ctx2d.stroke();
          ctx2d.restore();
        };
        for (const m of marks) ellipse(m, false);
        const d = draftRef.current;
        if (d !== null) ellipse(d, mode === 'crop');
        else if (crop !== null) ellipse(crop, true);
      }, [marks, crop, mode]);

      react.useEffect(() => { redraw(); }, [version, stage, redraw]);

      const toImg = (e) => {
        const c = previewRef.current;
        const r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
      };
      const onDown = (e) => {
        if (shotRef.current === null) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toImg(e);
        draftRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        setVersion((v) => v + 1);
      };
      const onMove = (e) => {
        if (draftRef.current === null) return;
        const p = toImg(e);
        draftRef.current = { ...draftRef.current, x1: p.x, y1: p.y };
        setVersion((v) => v + 1);
      };
      const onUp = () => {
        const d = draftRef.current;
        draftRef.current = null;
        if (d === null) return;
        const box = { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1) };
        if (box.x1 - box.x0 < 8 && box.y1 - box.y0 < 8) {
          setVersion((v) => v + 1);
          return;
        }
        if (mode === 'draw') setMarks((prev) => [...prev, box]);
        else setCrop(box);
        setVersion((v) => v + 1);
      };

      const applyCrop = () => {
        const shot = shotRef.current;
        if (shot === null || crop === null) return;
        const sx = Math.max(0, Math.round(crop.x0));
        const sy = Math.max(0, Math.round(crop.y0));
        const sw = Math.min(shot.canvas.width - sx, Math.round(crop.x1 - crop.x0));
        const sh = Math.min(shot.canvas.height - sy, Math.round(crop.y1 - crop.y0));
        if (sw < 16 || sh < 16) return;
        const nc = document.createElement('canvas');
        nc.width = sw;
        nc.height = sh;
        nc.getContext('2d').drawImage(shot.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        shotRef.current = { canvas: nc };
        setMarks((prev) => prev.map((m) => ({ x0: m.x0 - sx, y0: m.y0 - sy, x1: m.x1 - sx, y1: m.y1 - sy })));
        setCrop(null);
        setVersion((v) => v + 1);
      };

      const injectFile = (blob) => {
        if (blob === null) {
          setError('导出图片失败，请重试');
          return;
        }
        const file = new File([blob], 'photo-' + Date.now() + '.jpg', { type: 'image/jpeg' });
        const input = document.querySelector('input[type="file"][multiple][hidden]');
        if (input === null) {
          setError('未找到对话输入框，请先打开一个对话再拍照');
          return;
        }
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        setOpen(false);
      };

      const capture = () => {
        const video = videoRef.current;
        if (video === null || video.videoWidth === 0) {
          setError('画面尚未就绪，请稍候再拍');
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        shotRef.current = { canvas };
        setMarks([]);
        setCrop(null);
        setMode('draw');
        setStage('edit');
        setVersion((v) => v + 1);
      };

      const finish = () => {
        const shot = shotRef.current;
        if (shot === null) return;
        const out = document.createElement('canvas');
        out.width = shot.canvas.width;
        out.height = shot.canvas.height;
        const ctx2d = out.getContext('2d');
        ctx2d.drawImage(shot.canvas, 0, 0);
        const lw = Math.max(3, Math.round(out.width / 300));
        ctx2d.strokeStyle = MARK_COLOR;
        ctx2d.lineWidth = lw;
        for (const m of marks) {
          ctx2d.beginPath();
          ctx2d.ellipse((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, Math.abs(m.x1 - m.x0) / 2 || 1, Math.abs(m.y1 - m.y0) / 2 || 1, 0, 0, Math.PI * 2);
          ctx2d.stroke();
        }
        out.toBlob(injectFile, 'image/jpeg', 0.92);
      };

      const btnStyle = {
        width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer',
        border: '0.5px solid var(--dsw-alias-border-l2-darkmode-thin, #444)',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary, #bbb)',
        display: 'grid', placeItems: 'center', padding: '0',
      };
      const smallBtn = (active) => ({
        padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
        border: active ? '1px solid #2f6feb' : '1px solid transparent',
        background: active ? 'rgba(47,111,235,0.35)' : 'rgba(255,255,255,0.12)',
        color: '#fff', fontSize: '13px',
      });

      return h(react.Fragment, null,
        h('button', {
          type: 'button', 'aria-label': '拍照', title: '拍照提问',
          style: btnStyle, onClick: () => setOpen(true),
        },
          h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' },
            h('path', { d: 'M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.2-2h7.4l1.2 2h2.6A1.5 1.5 0 0 1 21 8.5v10A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z' }),
            h('circle', { cx: 12, cy: 13, r: 3.6 }),
          ),
        ),
        open
          ? h('div', {
              style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' },
              onMouseDown: (e) => { if (e.target === e.currentTarget) setOpen(false); },
            },
              h('div', {
                style: { width: 'min(720px, 94vw)', background: '#1c1e22', color: '#e8e8e8', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
              },
                h('div', { style: { fontSize: '14px', fontWeight: 600 } }, stage === 'camera' ? '拍照提问' : '编辑：圈出关键区域 / 剪切'),
                stage === 'camera'
                  ? h('video', { ref: videoRef, autoPlay: true, muted: true, playsInline: true, style: { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: '10px', background: '#000' } })
                  : h('canvas', {
                      ref: previewRef,
                      width: shotRef.current === null ? 4 : shotRef.current.canvas.width,
                      height: shotRef.current === null ? 3 : shotRef.current.canvas.height,
                      onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp,
                      style: { width: '100%', maxHeight: '58vh', objectFit: 'contain', borderRadius: '10px', background: '#000', touchAction: 'none', cursor: 'crosshair' },
                    }),
                error !== '' ? h('div', { style: { color: '#ff8080', fontSize: '12px' } }, error) : null,
                stage === 'camera'
                  ? h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
                      h('button', { type: 'button', style: smallBtn(false), onClick: () => setFacing((f) => (f === 'environment' ? 'user' : 'environment')) }, '切换摄像头'),
                      h('button', { type: 'button', style: smallBtn(false), onClick: () => setOpen(false) }, '取消'),
                      h('button', { type: 'button', style: { ...smallBtn(true), opacity: ready ? 1 : 0.5 }, disabled: !ready, onClick: capture }, '📷 拍照'),
                    )
                  : h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                      h('button', { type: 'button', style: smallBtn(mode === 'draw'), onClick: () => setMode('draw') }, '⭕ 圈选'),
                      h('button', { type: 'button', style: smallBtn(mode === 'crop'), onClick: () => setMode('crop') }, '✂ 剪切'),
                      crop !== null ? h('button', { type: 'button', style: smallBtn(true), onClick: applyCrop }, '应用裁剪') : null,
                      h('button', { type: 'button', style: smallBtn(false), onClick: () => { setMarks((prev) => prev.slice(0, -1)); setVersion((v) => v + 1); } }, '撤销'),
                      h('button', { type: 'button', style: smallBtn(false), onClick: () => { setMarks([]); setCrop(null); setVersion((v) => v + 1); } }, '清除标记'),
                      h('div', { style: { flex: 1 } }),
                      h('button', { type: 'button', style: smallBtn(false), onClick: () => { stopStream(); setStage('camera'); } }, '重拍'),
                      h('button', { type: 'button', style: smallBtn(true), onClick: finish }, '✅ 加入对话'),
                    ),
              ),
            )
          : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        if (document.querySelector('style[data-kid-css="ai-tutor"]') === null) {
          const tag = document.createElement('style');
          tag.dataset.kidCss = 'ai-tutor';
          tag.textContent = CSS;
          document.head.appendChild(tag);
        }
        // 相机按钮 → 输入框左侧工具条（session 作用域，进入对话后出现）
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'ai-tutor-camera',
        }, CameraSeat));
      },
    };
  },
});
