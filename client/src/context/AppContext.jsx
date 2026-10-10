import React,{createContext,useContext,useEffect,useState}from 'react';
const AppContext=createContext();
export function AppProvider({children}){const[theme,setTheme]=useState(()=>localStorage.getItem('kenora_theme')||'light');const[token,setToken]=useState(()=>localStorage.getItem('kenora_token'));useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('kenora_theme',theme)},[theme]);const signOut=()=>{localStorage.removeItem('kenora_token');setToken(null)};return <AppContext.Provider value={{theme,setTheme,token,setToken,signOut}}>{children}</AppContext.Provider>}
export const useApp=()=>useContext(AppContext);
