import { useUI } from '../store/useUI.js'
export default function Toast() {
  const msg = useUI(s => s.toastMsg)
  const action = useUI(s => s.toastAction)
  return <div id="toast" className={msg ? 'show' : ''}>
    <span>{msg}</span>
    {action && <button className="toast-action" onClick={action.onClick}>{action.label}</button>}
  </div>
}
