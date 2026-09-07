import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

const _rolesLegibles = {
  'usuario': 'Usuario',
  'empleado': 'Empleado',
  'tecnico': 'Técnico',
  'gestor': 'Gestor',
  'admin': 'Administrador',
};

/// Las cuentas. Solo para administradores.
class Usuarios extends StatefulWidget {
  const Usuarios({super.key});

  @override
  State<Usuarios> createState() => _UsuariosState();
}

class _UsuariosState extends State<Usuarios> {
  List<Cuenta> _cuentas = [];
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    try {
      final datos = await SesionScope.de(context).api.get('/api/usuarios') as List;
      if (!mounted) return;
      setState(() {
        _cuentas = datos
            .map((e) => Cuenta.desdeJson(e as Map<String, dynamic>))
            .toList();
        _error = null;
        _cargando = false;
      });
    } on ErrorApi catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.mensaje;
        _cargando = false;
      });
    }
  }

  Future<void> _abrirFicha({Cuenta? cuenta}) async {
    final guardado = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => FichaUsuario(cuenta: cuenta)),
    );
    if (guardado == true) _cargar();
  }

  Future<void> _desbloquear(Cuenta cuenta) async {
    try {
      await SesionScope.de(context).api.post('/api/usuarios/${cuenta.id}/desbloquear');
      _cargar();
      _avisar('Cuenta desbloqueada.');
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  /// Suspender y levantar la suspensión.
  ///
  /// Está aquí y no solo en la web porque desde la cola de moderación se puede
  /// suspender con el teléfono, y una puerta que solo se cierra desde el móvil
  /// y solo se abre desde el ordenador es una trampa.
  Future<void> _suspender(Cuenta cuenta) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text('Suspender a ${cuenta.nombre}'),
        content: const Text(
          'Dejará de poder entrar, por contraseña y por Office 365, y se '
          'cerrarán las sesiones que tenga abiertas. Sus incidencias y sus '
          'mensajes anteriores se quedan como están.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Tema.rojo),
            onPressed: () => Navigator.pop(dialogo, true),
            child: const Text('Suspender'),
          ),
        ],
      ),
    );
    if (seguro != true || !mounted) return;

    try {
      await SesionScope.de(context).api.post('/api/usuarios/${cuenta.id}/suspender');
      _cargar();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _reactivar(Cuenta cuenta) async {
    try {
      await SesionScope.de(context).api.post('/api/usuarios/${cuenta.id}/reactivar');
      _cargar();
      _avisar('${cuenta.nombre} vuelve a poder entrar.');
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrar(Cuenta cuenta) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text('Eliminar a ${cuenta.nombre}'),
        content: const Text(
          'La cuenta dejará de existir y se cerrarán sus sesiones. '
          'Las incidencias que abrió se conservan.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Tema.rojo),
            onPressed: () => Navigator.pop(dialogo, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (seguro != true || !mounted) return;

    try {
      await SesionScope.de(context).api.delete('/api/usuarios/${cuenta.id}');
      _cargar();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  void _avisar(String texto, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? Tema.rojo : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final yo = SesionScope.de(context).usuario?.id;

    return Scaffold(
      appBar: AppBar(title: const Text('Usuarios')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _abrirFicha(),
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Nuevo'),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cargando && _cuentas.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _cuentas.isEmpty
                ? ListView(children: [
                    const SizedBox(height: 80),
                    Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
                  ])
                : ListView.separated(
                    padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
                    itemCount: _cuentas.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => _fila(_cuentas[i], yo),
                  ),
      ),
    );
  }

  Widget _fila(Cuenta c, int? yo) {
    final locales = c.locales.map((l) => l.nombre).join(', ');
    return Tarjeta(
      child: InkWell(
        onTap: () => _abrirFicha(cuenta: c),
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      c.nombre,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                  ),
                  if (c.entra) ...[
                    const Distintivo(texto: 'Office 365', color: Tema.gris),
                    const SizedBox(width: 6),
                  ],
                  if (c.bloqueada) ...[
                    const Distintivo(texto: 'Bloqueada', color: Tema.rojo, suave: false),
                    const SizedBox(width: 6),
                  ],
                  if (c.suspendida)
                    const Distintivo(texto: 'Suspendida', color: Tema.rojo, suave: false),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                '${c.email ?? c.usuario} · ${_rolesLegibles[c.rol] ?? c.rol}'
                '${c.grupoNombre != null ? ' · ${c.grupoNombre}' : ''}',
                style: const TextStyle(fontSize: 12.5, color: Tema.gris),
              ),
              if (locales.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  locales,
                  style: const TextStyle(fontSize: 12, color: Tema.gris),
                ),
              ] else if (c.rol == 'tecnico') ...[
                const SizedBox(height: 3),
                const Text(
                  'Todos los locales de su departamento',
                  style: TextStyle(fontSize: 12, color: Tema.gris, fontStyle: FontStyle.italic),
                ),
              ],
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (c.bloqueada)
                    TextButton.icon(
                      onPressed: () => _desbloquear(c),
                      icon: const Icon(Icons.lock_open, size: 16),
                      label: const Text('Desbloquear', style: TextStyle(fontSize: 12.5)),
                    ),
                  // Nadie se suspende ni se borra a sí mismo: el servidor
                  // tampoco lo permite.
                  if (c.id != yo)
                    c.suspendida
                        ? TextButton.icon(
                            onPressed: () => _reactivar(c),
                            icon: const Icon(Icons.check_circle_outline, size: 16),
                            label: const Text('Levantar', style: TextStyle(fontSize: 12.5)),
                          )
                        : TextButton.icon(
                            onPressed: () => _suspender(c),
                            icon: const Icon(Icons.block, size: 16, color: Tema.rojo),
                            label: const Text('Suspender',
                                style: TextStyle(fontSize: 12.5, color: Tema.rojo)),
                          ),
                  if (c.id != yo)
                    TextButton.icon(
                      onPressed: () => _borrar(c),
                      icon: const Icon(Icons.delete_outline, size: 16, color: Tema.rojo),
                      label: const Text('Eliminar',
                          style: TextStyle(fontSize: 12.5, color: Tema.rojo)),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Alta y edición de una cuenta.
class FichaUsuario extends StatefulWidget {
  const FichaUsuario({super.key, this.cuenta});

  final Cuenta? cuenta;

  @override
  State<FichaUsuario> createState() => _FichaUsuarioState();
}

class _FichaUsuarioState extends State<FichaUsuario> {
  final _formulario = GlobalKey<FormState>();
  late final _nombre = TextEditingController(text: widget.cuenta?.nombre ?? '');
  late final _email = TextEditingController(text: widget.cuenta?.email ?? '');
  final _password = TextEditingController();

  late String _rol = widget.cuenta?.rol ?? 'usuario';
  late int? _grupoId = widget.cuenta?.grupoId;
  late Set<int> _locales = {...(widget.cuenta?.locales ?? []).map((l) => l.id)};

  bool _enviando = false;
  String? _error;

  bool get _esAlta => widget.cuenta == null;

  @override
  void dispose() {
    _nombre.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    if (!_formulario.currentState!.validate()) return;

    // Mismas reglas que comprueba el servidor, dichas antes de gastar el viaje.
    if (_rol == 'tecnico' && _grupoId == null) {
      setState(() => _error = 'Un técnico tiene que pertenecer a un departamento.');
      return;
    }
    if (_rol == 'empleado' && _locales.isEmpty) {
      setState(() => _error = 'Asigna al menos un local al empleado.');
      return;
    }

    setState(() {
      _enviando = true;
      _error = null;
    });

    final cuerpo = {
      'nombre': _nombre.text.trim(),
      'rol': _rol,
      'email': _email.text.trim(),
      'grupo_id': _rol == 'tecnico' ? _grupoId : null,
      'locales': _locales.toList(),
      if (_password.text.isNotEmpty) 'password': _password.text,
    };

    try {
      final api = SesionScope.de(context).api;
      if (_esAlta) {
        await api.post('/api/usuarios', cuerpo);
      } else {
        await api.put('/api/usuarios/${widget.cuenta!.id}', cuerpo);
      }
      if (mounted) Navigator.pop(context, true);
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final meta = SesionScope.de(context).meta;

    return Scaffold(
      appBar: AppBar(title: Text(_esAlta ? 'Nuevo usuario' : widget.cuenta!.nombre)),
      body: Form(
        key: _formulario,
        child: ListView(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
          children: [
            TextFormField(
              controller: _nombre,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Nombre'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'El nombre es obligatorio.' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _email,
              autocorrect: false,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'Correo',
                helperText: 'Con él entra en la aplicación y recibe los avisos',
              ),
              validator: (v) {
                final texto = (v ?? '').trim();
                if (texto.isEmpty) {
                  return _esAlta ? 'El correo es obligatorio.' : null;
                }
                // La comprobación de verdad la hace el servidor; esto solo
                // ahorra el viaje cuando falta la arroba a simple vista.
                return RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(texto)
                    ? null
                    : 'El correo no es válido.';
              },
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _password,
              obscureText: true,
              decoration: InputDecoration(
                labelText: 'Contraseña',
                helperText: _esAlta
                    ? 'Al menos 8 caracteres'
                    : 'Déjala vacía para no cambiarla',
              ),
              validator: (v) {
                if (_esAlta && (v == null || v.length < 8)) {
                  return 'Al menos 8 caracteres.';
                }
                if (!_esAlta && v != null && v.isNotEmpty && v.length < 8) {
                  return 'Al menos 8 caracteres.';
                }
                return null;
              },
            ),
            const SizedBox(height: 18),
            DropdownButtonFormField<String>(
              value: _rol,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Rol'),
              items: [
                for (final r in _rolesLegibles.entries)
                  DropdownMenuItem(value: r.key, child: Text(r.value)),
              ],
              onChanged: (v) => setState(() {
                _rol = v ?? 'empleado';
                // Solo los técnicos pertenecen a un departamento.
                if (_rol != 'tecnico') _grupoId = null;
              }),
            ),
            if (_rol == 'tecnico') ...[
              const SizedBox(height: 14),
              DropdownButtonFormField<int>(
                value: _grupoId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Departamento'),
                items: [
                  for (final g in meta?.grupos ?? const <Catalogo>[])
                    DropdownMenuItem(value: g.id, child: Text(g.nombre)),
                ],
                onChanged: (v) => setState(() => _grupoId = v),
              ),
            ],
            const SizedBox(height: 20),
            const Text('Locales', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(
              _rol == 'tecnico'
                  ? 'Sin ninguno marcado, atiende todos los locales de su departamento. '
                      'Marcarlos es lo que lo limita.'
                  : 'Los locales en los que puede abrir incidencias y las que ve.',
              style: const TextStyle(fontSize: 12, color: Tema.gris),
            ),
            const SizedBox(height: 8),
            Tarjeta(
              child: Column(
                children: [
                  for (final l in meta?.locales ?? const <Catalogo>[])
                    CheckboxListTile(
                      dense: true,
                      title: Text(l.nombre, style: const TextStyle(fontSize: 14)),
                      value: _locales.contains(l.id),
                      onChanged: (marcado) => setState(() {
                        if (marcado == true) {
                          _locales.add(l.id);
                        } else {
                          _locales.remove(l.id);
                        }
                      }),
                    ),
                ],
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: Tema.rojo, fontSize: 13.5)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _enviando ? null : _guardar,
              child: _enviando
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Guardar'),
            ),
          ],
        ),
      ),
    );
  }
}
