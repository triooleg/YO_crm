import { createTheme, type MantineTheme, type ButtonProps, type SelectProps, type MantineColorsTuple } from "@mantine/core";

const yoleotardViolet: MantineColorsTuple = [
  "#f7f3ff",
  "#eee8ff",
  "#ded2ff",
  "#c9b6ff",
  "#ad92ff",
  "#916cff",
  "#6c4ad1",
  "#6334df",
  "#522bb8",
  "#432590",
];

/** Approved Overview variant; mount only around the overview workspace. */
export const overviewTheme = createTheme({
  fontSizes:{xs:'12px',sm:'12px',md:'14px'},
  radius:{md:'7px'},
  other:{crmControls:{controlHeight:38,horizontalPadding:12,buttonFontWeight:500,fieldLabelMarginBottom:5,fieldLabelColor:'#7772b6',fieldLabelFontWeight:400,fieldBorderColor:'#e5e0ff',highlightedFieldBackground:'#f5f2ff',editableTextColor:'#6635ff',fieldDescriptionMarginTop:5,fieldDescriptionColor:'#7772b6',fieldDescriptionLineHeight:1.4},overviewControls:{kpiPadding:{base:12,sm:15},attention:{red:{color:'#df1737',background:'#fff0f1',borderColor:'#ffe0e4'},orange:{color:'#a84b05',background:'#fff4e6',borderColor:'#ffe7cb'},violet:{color:'#5e21eb',background:'#eee8ff',borderColor:'#e3dbff'},blue:{color:'#0065ce',background:'#e7f4ff',borderColor:'#d3e9ff'}},periodArrowMinWidth:{base:35,sm:42},periodArrowPadding:{base:9,sm:12},shipment:{height:25,padding:8,radius:20,fontWeight:400}}},
  components:{
    Button:{styles:(_theme:MantineTheme,props:ButtonProps)=>({root:{fontSize:12,...(props.variant==='default'?{color:'#4c25eb',borderColor:'#e5e0ff',background:'#fff'}:{})}})},
    Input:{styles:{input:{fontSize:12,borderRadius:6,borderColor:'#e5e0ff'}}},
    Select:{styles:(_theme:MantineTheme,props:SelectProps)=>({input:{fontSize:12,...(props.size==='xs'?{height:27,minHeight:27,paddingLeft:8,paddingRight:25}:{height:40})}})},
    Badge:{styles:{root:{maxWidth:'100%',height:'auto',minHeight:22,lineHeight:1.25,padding:'3px 8px',fontSize:12,fontWeight:500,textTransform:'none'},label:{whiteSpace:'normal',overflow:'visible',textOverflow:'clip'}}},
    Tooltip:{styles:{tooltip:{fontSize:12,maxWidth:'calc(100vw - 24px)',overflowWrap:'anywhere'}}},
    Checkbox:{styles:{input:{cursor:'pointer'}}},
    SegmentedControl:{styles:{root:{background:'#fff',border:'1px solid #e5e0ff',borderRadius:5,padding:1},label:{fontSize:12,fontWeight:400,padding:'3px 6px',lineHeight:1.4},indicator:{background:'linear-gradient(120deg,#7841ff,#6332f2)',borderRadius:4}}},
  },
});

export const yoleotardTheme = createTheme({
  primaryColor: "yoleotard",
  primaryShade: 6,
  colors: {
    yoleotard: yoleotardViolet,
  },
  fontFamily:
    'Ubuntu, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Tahoma, Arial, sans-serif',
  headings: {
    fontFamily:
      'Ubuntu, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Tahoma, Arial, sans-serif',
    fontWeight: "700",
  },
  fontSizes: {
    xs: "11px",
    sm: "12px",
    md: "14px",
    lg: "18px",
    xl: "22px",
  },
  spacing: {
    xs: "6px",
    sm: "8px",
    md: "12px",
    lg: "18px",
    xl: "24px",
  },
  radius: {
    xs: "6px",
    sm: "8px",
    md: "10px",
    lg: "13px",
    xl: "18px",
  },
  breakpoints: {
    xs: "30em",
    sm: "45em",
    md: "62.5em",
    lg: "75em",
    xl: "90em",
  },
  defaultRadius: "md",
  focusRing: "auto",
  cursorType: "pointer",
  respectReducedMotion: true,
  other: {
    crmControls: {
      controlHeight: 38,
      horizontalPadding: 17,
      buttonFontWeight: 750,
      fieldLabelMarginBottom: 5,
      fieldLabelColor: "var(--muted)",
      fieldLabelFontWeight: 400,
      fieldBorderColor: "var(--line)",
      highlightedFieldBackground: "#eef9ff",
      editableTextColor: "#117ac0",
      fieldDescriptionMarginTop: 5,
      fieldDescriptionColor: "var(--muted)",
      fieldDescriptionLineHeight: 1.4,
    },
  },
});


/** Finance's approved visual variant; inherited by its dialogs without changing other CRM pages. */
export const financeReportTheme = createTheme({
  fontSizes: { xs: '12px', sm: '13px', md: '14px' },
  other: {
    crmControls: { ...yoleotardTheme.other!.crmControls, controlHeight: 34, horizontalPadding: 12, buttonFontWeight: 500 },
    financeReport: { accent: '#7b36ff', accentEnd: '#6730ff', border: '#e0dcff', muted: '#7772b6', ink: '#10104f' },
  },
  components: {
    Button: { styles: (theme: MantineTheme, props: ButtonProps) => ({root: {
      fontSize: props.size === 'md' ? 14 : 13, borderRadius: 5,
      ...(props.size === 'md' ? { height: 40, minHeight: 40 } : {}),
      ...(props.variant === 'filled' ? { background: `linear-gradient(120deg, ${theme.other.financeReport.accent}, ${theme.other.financeReport.accentEnd})` } : {}),
      ...(props.variant === 'default' ? { color: theme.other.financeReport.accent, borderColor: theme.other.financeReport.border } : {}),
    }}) },
    Input: { styles: { input: { fontSize: 13, borderRadius: 5, borderColor: '#e0dcff' } } },
    Pagination: { defaultProps: { size: 'md', radius: 'sm' }, styles: { control: { borderRadius: 5 } } },
    SegmentedControl: { styles: { root: { background: '#fff', border: '1px solid #e0dcff', borderRadius: 4 }, label: { fontSize: 12, fontWeight: 400 }, indicator: { background: 'linear-gradient(120deg,#7b36ff,#6730ff)', borderRadius: 3 } } },
  },
});
