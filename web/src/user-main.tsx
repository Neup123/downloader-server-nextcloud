import React from 'react';
import ReactDOM from 'react-dom/client';
import UserApp from './UserApp';
import './style.css';
import './user.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><UserApp /></React.StrictMode>,
);
