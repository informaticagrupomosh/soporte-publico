import 'package:intl/intl.dart';

/// Las etiquetas en castellano de los códigos que guarda la base, iguales que
/// las de la web para que la app y el navegador digan lo mismo.
const etiquetasEstado = {
  'abierto': 'Abierto',
  'pendiente': 'Pendiente',
  'cerrado': 'Cerrado',
};

const etiquetasPrioridad = {
  'urgente': 'Urgente',
  'normal': 'Normal',
  'cuando_se_pueda': 'Cuando se pueda',
};

String etiquetaEstado(String v) => etiquetasEstado[v] ?? v;

String etiquetaPrioridad(String v) => etiquetasPrioridad[v] ?? v;

/// «hace 5 min» mientras es reciente y la fecha corta cuando ya no lo es: en una
/// lista de averías importa más lo que acaba de pasar que la fecha exacta.
String cuando(DateTime? fecha) {
  if (fecha == null) return '';
  final diferencia = DateTime.now().difference(fecha);
  if (diferencia.inSeconds < 60) return 'ahora mismo';
  if (diferencia.inMinutes < 60) return 'hace ${diferencia.inMinutes} min';
  if (diferencia.inHours < 24) return 'hace ${diferencia.inHours} h';
  if (diferencia.inDays == 1) return 'ayer';
  if (diferencia.inDays < 7) return 'hace ${diferencia.inDays} días';
  return DateFormat('d MMM y', 'es').format(fecha);
}

String fechaHora(DateTime? fecha) =>
    fecha == null ? '' : DateFormat('d MMM y, HH:mm', 'es').format(fecha);

String horaCorta(DateTime? fecha) =>
    fecha == null ? '' : DateFormat('HH:mm', 'es').format(fecha);
