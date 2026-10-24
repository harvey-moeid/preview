import './style.css';
document.getElementById('app').innerHTML='<span>LOCAL MONOREPO FIXTURE</span><h1>One workspace. Many possibilities.</h1><p>Vite assets, JavaScript and CSS from a real fixture build.</p><button id="counter">Clicked 0 times</button>';
let count=0;document.getElementById('counter').addEventListener('click',event=>{count++;event.target.textContent=`Clicked ${count} times`;});
