  document.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await API.post('/auth/login', { email: email.value, password: password.value });
      const next = new URLSearchParams(location.search).get('next');
      location.href = next && next.startsWith('/') ? next : '/';
    } catch (err) { document.querySelector('#err').textContent = err.message; }
  };
