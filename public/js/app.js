// Tiny progressive enhancements. The portal works without any of this.
(function () {
  // Show / hide password
  document.querySelectorAll('[data-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.querySelector(btn.getAttribute('data-toggle'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.classList.toggle('is-on', show);
    });
  });

  // Live unit counter on course registration
  var form = document.querySelector('form[data-max]');
  if (form) {
    var max = Number(form.getAttribute('data-max'));
    var out = document.getElementById('unit-total');
    var boxes = form.querySelectorAll('input[type=checkbox]');
    var update = function () {
      var total = 0;
      boxes.forEach(function (b) { if (b.checked) total += Number(b.getAttribute('data-units')); });
      out.innerHTML = 'Selected: <strong>' + total + '</strong> of ' + max + ' units';
      out.classList.toggle('over', total > max);
    };
    boxes.forEach(function (b) { b.addEventListener('change', update); });
    update();
  }

  // Show "level" only when creating a student
  var role = document.getElementById('role');
  if (role) {
    var only = document.querySelector('[data-only="student"]');
    var sync = function () { only.hidden = role.value !== 'student'; };
    role.addEventListener('change', sync);
    sync();
  }

  // Let success messages fade away
  document.querySelectorAll('.flash-ok').forEach(function (el) {
    setTimeout(function () { el.classList.add('fade'); }, 6000);
  });
})();
