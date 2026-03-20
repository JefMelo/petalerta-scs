import streamlit as st
import pandas as pd
from datetime import datetime
import base64
from PIL import Image
import io
import folium
from streamlit_folium import st_folium

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- FUNÇÃO DE LEITURA DIRETA ---
def ler_planilha_direto(nome_aba):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={nome_aba}"
    try:
        df = pd.read_csv(url)
        return df.astype(str).replace('nan', '')
    except:
        return pd.DataFrame()

# --- INJEÇÃO DE CSS (Identidade do Pet e Zoom) ---
st.markdown("""
<style>
    .pet-card {
        border: 2px solid #ddd; border-radius: 12px; margin-bottom: 25px;
        background-color: #fff; box-shadow: 3px 3px 10px rgba(0,0,0,0.1); overflow: hidden;
    }
    .pet-card-header { background-color: #f8f9fa; padding: 12px 18px; border-bottom: 2px solid #eee; }
    .pet-card h3 { margin: 0; color: #2c3e50; font-size: 1.5rem; }
    .pet-card-body { display: flex; gap: 15px; padding: 15px; flex-wrap: wrap; }
    .pet-card-foto { width: 140px; height: 140px; object-fit: cover; border-radius: 10px; border: 1px solid #ddd; }
    .pet-card-info { flex: 1; min-width: 200px; }
    .pet-card-info p { margin: 4px 0; font-size: 1rem; color: #444; }
    .pet-card-footer { background: #fafafa; padding: 10px 15px; border-top: 1px solid #eee; }
    .pagina-zoom { text-align: center; padding: 20px; }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES DE APOIO ---
def verificar_login(user_in, pwd_in):
    df_u = ler_planilha_direto(ABA_USUARIOS)
    if df_u.empty: return None
    u_c, p_c = str(user_in).strip().lower(), str(pwd_in).strip()
    for _, r in df_u.iterrows():
        db_u, db_p = str(r['Usuario']).strip().lower(), str(r['Senha']).strip()
        if db_p.endswith('.0'): db_p = db_p[:-2]
        if u_c == db_u and p_c == db_p: return r.to_dict()
    return None

def processar_foto(arquivo):
    if arquivo:
        img = Image.open(arquivo)
        if img.mode in ("RGBA", "P"): img = img.convert("RGB")
        img.thumbnail((800, 800))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode()
    return ""

def ir_para(p):
    st.session_state.pagina = p
    st.session_state.pagina_detalhes = None
    st.rerun()

# --- TELA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.markdown('<div class="pagina-zoom">', unsafe_allow_html=True)
    st.image(f"data:image/jpeg;base64,{st.session_state.pagina_detalhes}", use_container_width=True)
    if st.button("⬅️ VOLTAR AO MURAL", use_container_width=True, type="primary"):
        st.session_state.pagina_detalhes = None
        st.rerun()
    st.markdown('</div>', unsafe_allow_html=True)
    st.stop()

# --- SIDEBAR ---
with st.sidebar:
    st.title("🐾 Menu")
    if not st.session_state.logado:
        u_l = st.text_input("Usuário")
        p_l = st.text_input("Senha", type="password")
        if st.button("Entrar", use_container_width=True):
            user = verificar_login(u_l, p_l)
            if user:
                st.session_state.logado, st.session_state.user = True, user
                st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("🏠 Home", use_container_width=True): ir_para('home')
        if st.button("🚪 Sair", use_container_width=True):
            st.session_state.logado = False
            ir_para('home')

# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = ler_planilha_direto(ABA_PETS)

    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df.iterrows():
            try:
                # Filtrar apenas os que contêm "Perdido" na coluna unificada
                if "Perdido" in str(pet['DataStatus']):
                    esp = str(pet['Especie']).lower()
                    icon_c = 'orange' if 'cão' in esp or 'cao' in esp else ('blue' if 'gato' in esp else 'green')
                    folium.Marker([float(pet['Lat']), float(pet['Lng'])], 
                                  popup=f"<b>{pet['Nome_Pet']}</b>", 
                                  icon=folium.Icon(color=icon_c, icon='paw', prefix='fa')).add_to(m)
            except: continue
    st_folium(m, width=700, height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", type="primary", use_container_width=True): ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        for _, pet in df.iterrows():
            if "Perdido" in str(pet['DataStatus']):
                st.markdown(f'''
                    <div class="pet-card">
                        <div class="pet-card-header"><h3>{pet['Nome_Pet']}</h3></div>
                        <div class="pet-card-body">
                            <img src="data:image/jpeg;base64,{pet['Foto']}" class="pet-card-foto">
                            <div class="pet-card-info">
                                <p><b>Espécie:</b> {pet['Especie']} | <b>Raça:</b> {pet.get('Raca', '-')}</p>
                                <p><b>Cor:</b> {pet.get('Cor', '-')}</p>
                                <p><b>Características:</b> {pet.get('Caracteristicas', '-')}</p>
                            </div>
                        </div>
                        <div class="pet-card-footer">
                            <p>📍 <i>Visto por último em: {pet['Local_Desaparecimento']}</i></p>
                        </div>
                    </div>
                ''', unsafe_allow_html=True)
                c1, c2 = st.columns(2)
                with c1:
                    if st.button("🔍 Ver Foto", key=f"z_{pet['ID']}", use_container_width=True):
                        st.session_state.pagina_detalhes = pet['Foto']
                        st.rerun()
                with c2:
                    if st.session_state.logado:
                        tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                        st.link_button("🟢 WhatsApp", f"https://wa.me/55{tel}", use_container_width=True)
                st.write("")

# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Animal Perdido")
    st.warning("Clique no mapa abaixo para marcar o local exato.")
    
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()

    with st.form("f_pet"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        raca = st.text_input("Raça")
        cor = st.text_input("Cor Principal")
        caract = st.text_area("Características Marcantes")
        bairro = st.text_input("Bairro/Localização aproximada")
        foto = st.file_uploader("Foto do Pet")
        
        if st.form_submit_button("🚀 PUBLICAR ALERTA"):
            if nome_p and st.session_state.temp_lat:
                with st.spinner("Salvando dados..."):
                    try:
                        foto_b64 = processar_foto(foto)
                        df_p = ler_planilha_direto(ABA_PETS)
                        u = st.session_state.user
                        
                        # DICIONÁRIO NA ORDEM EXATA DA SUA PLANILHA
                        dados_para_salvar = {
                            "ID": str(int(datetime.now().timestamp())),
                            "DataStatus": f"{datetime.now().strftime('%d/%m/%Y')} - Perdido",
                            "Especie": esp,
                            "Nome_Pet": nome_p,
                            "Raca": raca,
                            "Cor": cor,
                            "Caracteristicas": caract,
                            "Local_Desaparecimento": bairro,
                            "Lat": str(st.session_state.temp_lat),
                            "Lng": str(st.session_state.temp_lng),
                            "Foto": foto_b64,
                            "Nome_Tutor": u.get('Nome', ''),
                            "Tel_Tutor": u.get('Telefone', ''),
                            "User_Vinculo": u.get('Usuario', ''),
                            "Nascimento_Tutor": u.get('Nascimento', ''),
                            "Telefone_Tutor": u.get('Telefone', ''),
                            "Email_Tutor": u.get('Email', ''),
                            "Endereco_Tutor": u.get('Endereco', '')
                        }
                        
                        conn.update(worksheet=ABA_PETS, data=pd.concat([df_p, pd.DataFrame([dados_para_salvar])], ignore_index=True))
                        st.session_state.temp_lat = None
                        st.success("✅ Publicado!")
                        ir_para('home')
                    except Exception as e:
                        st.error(f"Erro na API do Google Sheets. Verifique o cabeçalho da planilha.")
            else: st.error("Faltam dados ou local no mapa!")

# --- PÁGINA: CADASTRO USUÁRIO ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("cad_u"):
        n, t, e, u, p = st.text_input("Nome"), st.text_input("WhatsApp"), st.text_input("Email"), st.text_input("Usuário"), st.text_input("Senha", type="password")
        if st.form_submit_button("CADASTRAR"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            novo = pd.DataFrame([{"Usuario":u,"Senha":p,"Nivel":"Membro","Telefone":t,"Email":e,"Nascimento":"","Endereco":"","Nome":n}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
            st.success("Conta criada!")
            ir_para('home')
