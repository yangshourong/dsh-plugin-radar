/**
 * Browser half for dsh-plugin-radar: the plugin's own configuration page.
 *
 * Registers into the Plugins page's `plugins.row.config` slot, keyed by
 * `<package>#<row id>`. The bundle's detail page then shows a configure control
 * on its row; opening it renders this form. The page owner supplies `form` (the
 * Host settings form for the row's namespace), so every write goes through
 * `form.mutate()`: the Host validates the complete Config and refuses stale
 * revisions. Only the user-facing fields are rendered; advanced options stay
 * editable through the profile patch.
 *
 * The module is a plain browser artifact for this deployment's module loader:
 * React comes from the shared module table, and all registration happens inside
 * `apply` so the plugin unloads cleanly.
 */
window.__ModuleLoader__.load({
  id: '@yangshourong/dsh-plugin-radar-ysr',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** This package's npm name; the slot key is keyed by it. */
    const PACKAGE_NAME = '@yangshourong/dsh-plugin-radar-ysr'
    /** The row id the bundle patch declares; also the settings namespace of this row. */
    const ROW_ID = 'dsh-plugin-radar-ysr'
    /** `plugins.row.config` key: `<package name>#<row id>`. */
    const SLOT_KEY = `${PACKAGE_NAME}#${ROW_ID}`

    /** Fields rendered on this page, in display order. */
    const FIELDS = ['defaultLang', 'maxResults', 'liveSearch', 'curatedFallback']
    /** Secret config field holding the optional GitHub token. */
    const TOKEN_FIELD = 'githubToken'
    /** Choices offered for the result cap; a custom configured value is kept selectable. */
    const RESULT_CHOICES = [5, 8, 10, 15, 20]

    const COLORS = {
      primary: 'var(--dsw-alias-label-primary, #1f2328)',
      secondary: 'var(--dsw-alias-label-secondary, #57606a)',
      border: 'var(--dsw-alias-border-l1, rgba(31, 35, 40, .15))',
      borderStrong: 'var(--dsw-alias-border-l2, rgba(31, 35, 40, .3))',
      brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      error: 'var(--dsw-alias-state-error-primary, #d1242f)',
      success: 'var(--dsw-alias-state-success-primary, #1a7f37)',
      surface: 'var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, .02))',
    }

    const styles = {
      wrap: { display: 'grid', gap: '16px', color: COLORS.primary, fontSize: '13px', lineHeight: '1.5' },
      intro: { margin: 0, color: COLORS.secondary, fontSize: '12px' },
      row: { display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '12px', alignItems: 'start' },
      label: { fontWeight: 600, paddingTop: '4px' },
      hint: { margin: '5px 0 0', color: COLORS.secondary, fontSize: '12px' },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '220px',
        padding: '6px 8px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '6px',
        background: COLORS.surface,
        color: COLORS.primary,
        font: 'inherit',
      },
      checkboxRow: { display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '3px' },
      footer: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', borderTop: `1px solid ${COLORS.border}`, paddingTop: '14px' },
      primaryButton: {
        padding: '6px 14px',
        border: 'none',
        borderRadius: '6px',
        background: COLORS.brand,
        color: '#fff',
        font: 'inherit',
        fontWeight: 600,
        cursor: 'pointer',
      },
      secondaryButton: {
        padding: '6px 12px',
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: '6px',
        background: 'transparent',
        color: COLORS.primary,
        font: 'inherit',
        cursor: 'pointer',
      },
      message: { margin: 0, fontSize: '12px', color: COLORS.secondary },
      unavailable: { margin: 0, color: COLORS.error, fontSize: '12px' },
      linkButton: {
        border: 'none',
        background: 'transparent',
        color: COLORS.brand,
        cursor: 'pointer',
        font: 'inherit',
        padding: '0',
        textDecoration: 'underline',
      },
    }

    /** Loopback endpoints served by the Host half. */
    const STATUS_URL = '/dsh-plugin-radar/status'
    const VALIDATE_URL = '/dsh-plugin-radar/token/validate'

    /** Fetch JSON from the Host route, with same-origin credentials. */
    async function fetchJson(url, init) {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
      const body = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(body?.error === undefined ? `HTTP ${response.status}` : String(body.error))
      return body
    }

    /** Coerce the accepted Host values into the four fields this page edits. */
    function readAccepted(snapshot) {
      const value = snapshot !== undefined && snapshot.status === 'ready' && snapshot.value !== undefined && snapshot.value !== null
        ? snapshot.value
        : {}
      const language = value.defaultLang === 'zh' ? 'zh' : 'en'
      const limit = Number(value.maxResults)
      return {
        defaultLang: language,
        maxResults: Number.isFinite(limit) && limit >= 1 ? Math.trunc(limit) : 8,
        liveSearch: value.liveSearch !== false,
        curatedFallback: value.curatedFallback !== false,
      }
    }

    /** Build the ordered `set` operations that turn accepted values into the draft. */
    function buildOps(accepted, draft) {
      const ops = []
      for (const field of FIELDS) {
        if (JSON.stringify(accepted[field]) !== JSON.stringify(draft[field])) {
          ops.push({ op: 'set', path: [field], value: draft[field] })
        }
      }
      return ops
    }

    /** The user-layer keys this page can restore to inherited defaults. */
    function overriddenFields(snapshot) {
      const user = snapshot !== undefined && snapshot.user !== undefined && snapshot.user !== null && typeof snapshot.user === 'object'
        ? snapshot.user
        : {}
      return FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(user, field))
    }

    /** One labelled field row. */
    function fieldRow(id, label, control, hint) {
      return h(
        'div',
        { style: styles.row },
        h('label', { style: styles.label, htmlFor: id }, label),
        h('div', null, control, h('p', { style: styles.hint }, hint)),
      )
    }

    /** The plugins.row.config page for this bundle's row. */
    function ConfigPage(props) {
      const form = props.form
      const snapshot = form === undefined ? undefined : form.state
      const accepted = readAccepted(snapshot)
      const acceptedKey = `${snapshot === undefined ? 'none' : String(snapshot.revision)}|${JSON.stringify(accepted)}`

      // A local draft so edits survive re-renders; it follows Host values unless the user is editing.
      const [draft, setDraft] = React.useState(accepted)
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState({ tone: 'info', text: '' })
      // The token is a secret: the Host never sends it back, so it lives only in this draft.
      const [tokenDraft, setTokenDraft] = React.useState('')
      // Host-reported token status; the value itself is never returned.
      const [tokenStatus, setTokenStatus] = React.useState({ loading: true, configured: false, source: 'none', quota: undefined, error: '' })
      // Validation result for the token currently typed into the draft.
      const [tokenCheck, setTokenCheck] = React.useState(undefined)
      React.useEffect(() => {
        if (!dirty) setDraft(accepted)
      }, [acceptedKey, dirty])
      React.useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        fetchJson(STATUS_URL, { signal: controller.signal })
          .then((data) => {
            if (cancelled) return
            setTokenStatus({
              loading: false,
              configured: data?.token?.configured === true,
              source: data?.token?.source ?? 'none',
              quota: undefined,
              error: '',
            })
          })
          .catch((error) => {
            if (cancelled) return
            setTokenStatus({ loading: false, configured: false, source: 'none', quota: undefined, error: error instanceof Error ? error.message : String(error) })
          })
        return () => {
          cancelled = true
          controller.abort()
        }
      }, [])

      if (props.view === 'summary') {
        const languageText = accepted.defaultLang === 'zh' ? '中文' : 'English'
        return h('span', null, `介绍语言 ${languageText} · 最多 ${accepted.maxResults} 条`)
      }

      const status = snapshot === undefined ? 'unavailable' : snapshot.status
      const writable = status === 'ready' && snapshot.writable === true
      const disabled = busy || !writable
      const changes = buildOps(accepted, draft)
      const overridden = overriddenFields(snapshot)
      const resultChoices = RESULT_CHOICES.includes(draft.maxResults)
        ? RESULT_CHOICES
        : [...RESULT_CHOICES, draft.maxResults].sort((a, b) => a - b)

      const update = (patch) => {
        setDraft((previous) => ({ ...previous, ...patch }))
        setDirty(true)
        setMessage({ tone: 'info', text: '' })
      }

      const save = async () => {
        if (form === undefined || !writable || busy) return
        const tokenValue = tokenDraft.trim()
        if (changes.length === 0 && tokenValue.length === 0) {
          setDirty(false)
          return
        }
        const ops = [...changes]
        if (tokenValue.length > 0) ops.push({ op: 'set', path: [TOKEN_FIELD], value: tokenValue })
        setBusy(true)
        setMessage({ tone: 'info', text: '正在保存…' })
        try {
          const acceptedWrite = await form.mutate(ops, snapshot.revision)
          if (acceptedWrite) {
            setDirty(false)
            setTokenDraft('')
            void refreshTokenStatus(false)
            setMessage({
              tone: 'success',
              text: tokenValue.length > 0
                ? '已保存，下一次搜索立即生效；GitHub Token 已更新（出于安全不再回显）。'
                : '已保存，下一次搜索立即生效。',
            })
          } else {
            setMessage({ tone: 'error', text: '保存被拒绝：配置可能刚被其他页面修改，请刷新后重试。' })
          }
        } catch (error) {
          setMessage({ tone: 'error', text: `保存失败：${error instanceof Error ? error.message : String(error)}` })
        } finally {
          setBusy(false)
        }
      }

      const removeToken = async () => {
        if (form === undefined || !writable || busy) return
        setBusy(true)
        setMessage({ tone: 'info', text: '正在移除 Token…' })
        try {
          const acceptedWrite = await form.mutate([{ op: 'unset', path: [TOKEN_FIELD] }], snapshot.revision)
          setTokenDraft('')
          if (acceptedWrite) void refreshTokenStatus(false)
          setMessage(acceptedWrite
            ? { tone: 'success', text: 'GitHub Token 已移除，搜索会退回匿名额度（10 次/分）。' }
            : { tone: 'error', text: '移除被拒绝，请刷新后重试。' })
        } catch (error) {
          setMessage({ tone: 'error', text: `移除失败：${error instanceof Error ? error.message : String(error)}` })
        } finally {
          setBusy(false)
        }
      }

      const refreshTokenStatus = async (checkQuota) => {
        setTokenStatus((previous) => ({ ...previous, loading: true, error: '' }))
        try {
          const data = await fetchJson(checkQuota ? `${STATUS_URL}?check=1` : STATUS_URL)
          setTokenStatus({
            loading: false,
            configured: data?.token?.configured === true,
            source: data?.token?.source ?? 'none',
            quota: data?.quota,
            error: '',
          })
        } catch (error) {
          setTokenStatus((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      const validateDraftToken = async () => {
        const tokenValue = tokenDraft.trim()
        if (tokenValue.length === 0) {
          setTokenCheck({ kind: 'info', text: '请先粘贴 Token' })
          return
        }
        setBusy(true)
        setTokenCheck({ kind: 'info', text: '正在验证…' })
        try {
          const data = await fetchJson(VALIDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenValue }),
          })
          if (data?.valid === true) {
            const suffix = data.searchRemaining === undefined ? '' : `（剩余 ${data.searchRemaining} 次）`
            setTokenCheck({ kind: 'ok', text: `${data.message ?? 'Token 有效'}${suffix}` })
          } else {
            setTokenCheck({ kind: 'error', text: data?.message ?? 'Token 无效' })
          }
        } catch (error) {
          setTokenCheck({ kind: 'error', text: `验证失败：${error instanceof Error ? error.message : String(error)}` })
        } finally {
          setBusy(false)
        }
      }

      const restoreDefaults = async () => {
        if (form === undefined || !writable || busy || overridden.length === 0) return
        setBusy(true)
        setMessage({ tone: 'info', text: '正在恢复默认…' })
        try {
          const acceptedWrite = await form.mutate(
            overridden.map((field) => ({ op: 'unset', path: [field] })),
            snapshot.revision,
          )
          setMessage(acceptedWrite
            ? { tone: 'success', text: '已恢复默认设置。' }
            : { tone: 'error', text: '恢复被拒绝，请刷新后重试。' })
          if (acceptedWrite) setDirty(false)
        } catch (error) {
          setMessage({ tone: 'error', text: `恢复失败：${error instanceof Error ? error.message : String(error)}` })
        } finally {
          setBusy(false)
        }
      }

      const messageColor = message.tone === 'error' ? COLORS.error : message.tone === 'success' ? COLORS.success : COLORS.secondary
      const children = [
        h('p', { style: styles.intro }, '改完点保存立即生效；只影响「插件雷达」自己的行为，不需要重启。'),
      ]

      if (form === undefined || status === 'unavailable') {
        children.push(h('p', { style: styles.unavailable }, '宿主没有提供可写的设置表单（可能是不支持配置页的 DSH 版本）。'))
        return h('div', { style: styles.wrap }, children)
      }
      if (status === 'loading') {
        children.push(h('p', { style: styles.message }, '正在读取当前设置…'))
        return h('div', { style: styles.wrap }, children)
      }

      children.push(fieldRow(
        'radar-default-lang',
        '介绍语言',
        h('select', {
          id: 'radar-default-lang',
          style: styles.input,
          value: draft.defaultLang,
          disabled,
          onChange: (event) => update({ defaultLang: event.target.value === 'zh' ? 'zh' : 'en' }),
        },
        h('option', { value: 'en' }, 'English（英文）'),
        h('option', { value: 'zh' }, '中文'),
        ),
        '搜索结果的介绍优先显示哪种语言。',
      ))

      children.push(fieldRow(
        'radar-max-results',
        '一次最多几条',
        h('select', {
          id: 'radar-max-results',
          style: styles.input,
          value: String(draft.maxResults),
          disabled,
          onChange: (event) => update({ maxResults: Number(event.target.value) || 8 }),
        }, resultChoices.map((choice) => h('option', { key: choice, value: String(choice) }, String(choice)))),
        '单次搜索返回的结果数量上限（1–50）。',
      ))

      children.push(fieldRow(
        'radar-live-search',
        'GitHub 实时搜索',
        h('label', { style: styles.checkboxRow },
          h('input', {
            id: 'radar-live-search',
            type: 'checkbox',
            checked: draft.liveSearch,
            disabled,
            onChange: (event) => update({ liveSearch: event.target.checked }),
          }),
          h('span', null, draft.liveSearch ? '开启' : '关闭'),
        ),
        '关闭后只使用社区精选清单和内置离线索引。',
      ))

      const tokenStatusText = tokenStatus.loading
        ? '正在读取 Token 状态…'
        : tokenStatus.error.length > 0
          ? `无法读取 Token 状态：${tokenStatus.error}`
          : tokenStatus.configured
            ? `当前：已配置（来源：${tokenStatus.source === 'credential' ? 'DSH 凭据' : '配置页'}）${tokenStatus.quota?.valid === true && tokenStatus.quota.searchLimit !== undefined ? ` · 额度 ${tokenStatus.quota.searchLimit} 次/分` : ''}`
            : '当前：未配置（匿名额度 10 次/分）'

      children.push(fieldRow(
        'radar-github-token',
        'GitHub Token（可选）',
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            id: 'radar-github-token',
            type: 'password',
            style: { ...styles.input, maxWidth: '260px' },
            value: tokenDraft,
            disabled,
            autoComplete: 'off',
            spellCheck: false,
            placeholder: '粘贴 GitHub Token，留空表示不修改',
            onChange: (event) => {
              setTokenDraft(event.target.value)
              setTokenCheck(undefined)
              setMessage({ tone: 'info', text: '' })
            },
          }),
          h('button', {
            type: 'button',
            style: { ...styles.secondaryButton, ...(busy || tokenDraft.trim().length === 0 ? { opacity: 0.55, cursor: 'default' } : {}) },
            disabled: busy || tokenDraft.trim().length === 0,
            onClick: () => { void validateDraftToken() },
          }, '验证'),
          tokenStatus.configured
            ? h('button', {
              type: 'button',
              style: styles.linkButton,
              onClick: () => { void refreshTokenStatus(true) },
            }, '检查当前额度')
            : null,
        ),
        h('span', null,
          '配置后 GitHub 搜索额度从 10 次/分提升到 30 次/分；只保存在本机 profile 配置里，保存后不再回显，可随时移除。',
          h('br'),
          h('span', { style: { color: tokenStatus.error.length > 0 ? COLORS.error : COLORS.secondary } }, tokenStatusText),
          tokenCheck === undefined
            ? null
            : h('span', { style: { marginLeft: '8px', color: tokenCheck.kind === 'error' ? COLORS.error : tokenCheck.kind === 'ok' ? COLORS.success : COLORS.secondary } }, tokenCheck.text),
        ),
      ))

      children.push(fieldRow(
        'radar-curated-fallback',
        '精选/离线兜底',
        h('label', { style: styles.checkboxRow },
          h('input', {
            id: 'radar-curated-fallback',
            type: 'checkbox',
            checked: draft.curatedFallback,
            disabled,
            onChange: (event) => update({ curatedFallback: event.target.checked }),
          }),
          h('span', null, draft.curatedFallback ? '开启' : '关闭'),
        ),
        'GitHub 限流或断网时，回退到精选清单和内置离线索引。',
      ))

      children.push(h(
        'div',
        { style: styles.footer },
        h('button', {
          type: 'button',
          style: { ...styles.primaryButton, ...(disabled || (changes.length === 0 && tokenDraft.trim().length === 0) ? { opacity: 0.55, cursor: 'default' } : {}) },
          disabled: disabled || (changes.length === 0 && tokenDraft.trim().length === 0),
          onClick: () => { void save() },
        }, busy ? '保存中…' : '保存'),
        h('button', {
          type: 'button',
          style: { ...styles.secondaryButton, ...(disabled || overridden.length === 0 ? { opacity: 0.55, cursor: 'default' } : {}) },
          disabled: disabled || overridden.length === 0,
          onClick: () => { void restoreDefaults() },
        }, '恢复默认'),
        h('button', {
          type: 'button',
          style: { ...styles.secondaryButton, ...(disabled ? { opacity: 0.55, cursor: 'default' } : {}) },
          disabled,
          onClick: () => { void removeToken() },
        }, '移除已保存的 Token'),
        message.text.length > 0 ? h('p', { style: { ...styles.message, color: messageColor } }, message.text) : null,
      ))

      if (!snapshot.writable) {
        children.push(h('p', { style: styles.unavailable }, '当前 profile 不允许写入配置。'))
      }

      return h('div', { style: styles.wrap }, children)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          console.info('[dsh-plugin-radar] client half applying; registering', SLOT_KEY)
        } catch { /* console unavailable */ }
        try {
          if (typeof ctx.slots?.inject === 'function') {
            ctx.slots.inject('plugins.row.config', () => {
              try {
                return ctx.slots.register({ name: 'plugins.row.config', key: SLOT_KEY }, ConfigPage)
              } catch (error) {
                try { console.error('[dsh-plugin-radar] slot registration failed', error) } catch { /* ignore */ }
                return undefined
              }
            })
          } else if (typeof ctx.slots?.register === 'function') {
            ctx.slots.register({ name: 'plugins.row.config', key: SLOT_KEY }, ConfigPage)
          }
        } catch (error) {
          try { console.error('[dsh-plugin-radar] config page registration failed', error) } catch { /* ignore */ }
        }
      },
    }
  },
})
