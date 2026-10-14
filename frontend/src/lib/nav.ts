import type { NavigateFunction } from 'react-router-dom'
// Lets non-component modules (sheet flows) navigate. App registers the router's navigate.
let _nav: NavigateFunction = (() => {}) as NavigateFunction   // a no-op until App registers the router's navigate
export const setNav = (fn: NavigateFunction): void => { _nav = fn }
export const nav = (to: string | number): void => { _nav(to as string) }
